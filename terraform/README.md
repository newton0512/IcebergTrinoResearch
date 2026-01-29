# Terraform для развертывания Iceberg/Trino инфраструктуры на Selectel

Terraform конфигурация для автоматического развертывания тестовой среды с PostgreSQL, MinIO, Nessie и Trino на облаке [Selectel](https://selectel.ru/) (основано на OpenStack).

## Архитектура

Разворачиваются **два сервера**:

1. **Data Server** (16 vCPU / 64GB RAM / 300GB диск):
   - PostgreSQL - для пользовательских таблиц и системных таблиц Nessie
   - MinIO - S3-совместимое хранилище для Iceberg/Parquet данных
   - Nessie - catalog-сервис для управления метаданными Iceberg
   - Trino - SQL-движок для запросов к Iceberg данным
   - **Доступен только из внутренней сети** (без внешнего IP для безопасности)
   - Доступ извне через SSH портфорвардинг через Load Test Server

2. **Load Test Server** (4 vCPU / 8GB RAM / 50GB диск):
   - Node.js + pnpm - для запуска проекта samples-generation
   - API сервер - REST API для нагрузочного тестирования
   - Queue Worker - обработка очереди trino_queue
   - K6 - инструмент для нагрузочного тестирования (через Docker)
   - **Имеет внешний IP** для доступа и тестирования

## Prerequisites

1. [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0
2. Аккаунт в Selectel
3. Учетные данные API из [раздела API Keys](https://my.selectel.ru/profile/apikeys)
4. SSH ключ на локальной машине (публичный ключ будет загружен на серверы)

## Настройка

### 1. Экспорт учетных данных через переменные окружения

**ВАЖНО:** Не храните секреты в `terraform.tfvars`. Используйте переменные окружения:

```bash
export TF_VAR_selectel_domain="533343"
export TF_VAR_selectel_username="Newton"
export TF_VAR_selectel_password="your-selectel-password"
export TF_VAR_selectel_openstack_password="your-openstack-password"
```

Где:
- `selectel_domain` - номер аккаунта Selectel (domain_name)
- `selectel_username` - логин для Selectel API
- `selectel_password` - пароль для Selectel API
- `selectel_openstack_password` - пароль, который Terraform задаст создаваемому IAM service-user (для OpenStack provider)

### 2. Настройка переменных в terraform.tfvars

Скопируйте и отредактируйте `terraform.tfvars` (пример уже есть в репозитории):

```bash
cd terraform
# Отредактируйте terraform.tfvars с нужными значениями
```

Основные параметры:
- `environment_name` - суффикс для имен ресурсов (по умолчанию: "iceberg-test")
- `region` - регион Selectel (например "ru-9")
- `data_flavor_id` / `load_flavor_id` - ID flavor'ов для серверов
- `repo_url` / `repo_ref` / `repo_subdir` - параметры git-репозитория для деплоя
- `ssh_public_key_path` - путь к SSH публичному ключу на локальной машине

### 3. Инициализация Terraform

```bash
terraform init
```

## Развертывание инфраструктуры

### 1. План изменений

```bash
terraform plan
```

Проверьте что будет создано:
- Selectel VPC Project
- IAM service-user для OpenStack
- SSH keypair
- Приватная сеть и роутер
- 2 сервера (Data + Load Test)
- 1 Floating IP (только для Load Test Server, Data Server без внешнего IP)
- Security groups с правилами для портов

### 2. Применение изменений

```bash
terraform apply
```

Подтвердите выполнение (введите `yes`).

**Время развертывания:** ~3-5 минут

### 3. Получение информации о развернутой инфраструктуре

```bash
# Публичный IP Load Test Server (единственный внешний IP)
terraform output load_test_public_ip

# Приватные IP адреса
terraform output data_server_private_ip
terraform output load_test_private_ip

# Команды SSH
terraform output ssh_load_test_server              # Прямое подключение к Load Test Server
terraform output ssh_data_server_direct            # Прямое подключение к Data Server через jump host
terraform output ssh_data_server_via_tunnel        # SSH портфорвардинг для доступа к сервисам Data Server

# Команды для ожидания готовности (cloud-init завершен)
terraform output wait_for_data_server
terraform output wait_for_load_test_server
```

## Ожидание завершения установки (cloud-init)

Cloud-init автоматически:
- Устанавливает Docker, Node.js, pnpm (на Load Server)
- Клонирует git-репозиторий
- Запускает Docker Compose с сервисами (на Data Server)
- Настраивает Trino под ресурсы сервера
- Запускает API и queue-worker (на Load Server)

Дождитесь завершения cloud-init на обоих серверах:

```bash
# Ожидание готовности Load Test Server
eval $(terraform output -raw wait_for_load_test_server)

# Ожидание готовности Data Server (через jump host)
eval $(terraform output -raw wait_for_data_server)
```

Или вручную:

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Load Test Server
ssh root@$LOAD_IP 'while [ ! -f /root/cloud-init-ready-load ]; do echo "Waiting..."; sleep 10; done; echo "Ready!"'

# Data Server (через jump host)
ssh root@$LOAD_IP "ssh root@$DATA_PRIVATE 'while [ ! -f /root/cloud-init-ready-data ]; do echo \"Waiting...\"; sleep 10; done; echo \"Ready!\"'"
```

## Доступ к Data Server

Data Server находится во внутренней сети и не имеет внешнего IP. Доступ возможен двумя способами:

### Вариант 1: SSH портфорвардинг (рекомендуется для веб-интерфейсов)

Пробрасывает порты Data Server на ваш локальный компьютер:

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Пробросить все нужные порты (Trino-FTE:8080, MinIO API:9000, MinIO Console:9001)
ssh -L 8080:$DATA_PRIVATE:8080 \
    -L 9000:$DATA_PRIVATE:9000 \
    -L 9001:$DATA_PRIVATE:9001 \
    root@$LOAD_IP -N

# Теперь на локальном компьютере доступны:
# - Trino-FTE: http://localhost:8080
# - MinIO API: http://localhost:9000
# - MinIO Console: http://localhost:9001
```

Или используйте готовую команду из outputs:

```bash
# Команда уже содержит -N флаг (без открытия интерактивной сессии)
eval $(terraform output -raw ssh_data_server_via_tunnel)

# Для фонового режима добавьте -f
eval $(terraform output -raw ssh_data_server_via_tunnel) -f
```

### Вариант 2: Прямой SSH через jump host

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Подключение к Data Server через Load Test Server как jump host
ssh -J root@$LOAD_IP root@$DATA_PRIVATE

# Или используйте готовую команду:
eval $(terraform output -raw ssh_data_server_direct)
```

Настройте SSH config для удобства (опционально):

```bash
# Сначала получите значения
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Добавьте в ~/.ssh/config
cat >> ~/.ssh/config <<EOF
Host load-test-jump
    HostName $LOAD_IP
    User root
    IdentityFile ~/.ssh/id_rsa_terraform

Host data-server
    HostName $DATA_PRIVATE
    User root
    ProxyJump load-test-jump
    IdentityFile ~/.ssh/id_rsa_terraform
EOF

# Теперь просто: ssh data-server
```

## Проверка работы сервисов

### Data Server

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Через SSH портфорвардинг (после запуска туннеля)
# На локальном компьютере:
curl http://localhost:8080/v1/info  # Trino
curl http://localhost:9000/minio/health/live  # MinIO API
curl http://localhost:19120/api/v2/config  # Nessie (если пробросили порт)

# Через Load Test Server (из внутренней сети)
ssh root@$LOAD_IP "curl http://$DATA_PRIVATE:8080/v1/info"  # Trino
ssh root@$LOAD_IP "curl http://$DATA_PRIVATE:19120/api/v2/config"  # Nessie

# MinIO Console (откройте в браузере после запуска портфорвардинга)
echo "MinIO Console: http://localhost:9001 (после запуска SSH туннеля)"
echo "Credentials: minioadmin / minioadmin"

# Проверка PostgreSQL (из Load Test Server)
ssh root@$LOAD_IP "nc -zv $DATA_PRIVATE 5432"
```

### Load Test Server

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

# Проверка API сервера
curl http://$LOAD_IP:3000/api/health

# Проверка статуса сервисов
ssh root@$LOAD_IP 'systemctl status samples-api samples-queue-worker'
```

## Работа с проектом

### 1. Создание таблиц

После развертывания таблицы должны создаться автоматически через systemd service `samples-setup.service`. Если нет, создайте их вручную:

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

ssh root@$LOAD_IP
cd /opt/IcebergTrinoResearch/samples-generation
pnpm run setup:tables
```

Это создаст:
- **PostgreSQL**: таблицы `Saga`, `bonus_registry_unique_check`, `bonus_registry_balance_check`, `trino_queue`
- **Trino/Iceberg**: схему `iceberg.warehouse` и таблицу `bonus_registry`

### 2. Заполнение данными

#### Вариант A: Массовая вставка напрямую в Trino

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

ssh root@$LOAD_IP
cd /opt/IcebergTrinoResearch/samples-generation

# 500 миллионов строк (по умолчанию)
pnpm tsx scripts/write-trino-mass.ts

# С параметрами
pnpm tsx scripts/write-trino-mass.ts --rows 500000000 --batch-size 10000000

# Очистить таблицу перед заполнением
pnpm tsx scripts/write-trino-mass.ts --rows 500000000 --truncate
```

#### Вариант B: Через API + Queue Worker (реалистичная нагрузка)

Queue Worker уже запущен автоматически. Можно заполнять данные через API:

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

# Записать одну запись
curl -X POST http://$LOAD_IP:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{}'

# Проверить статус очереди
curl http://$LOAD_IP:3000/api/queue/status
```

### 3. Запуск нагрузочных тестов с K6

#### Подготовка

Убедитесь что API сервер работает:

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
curl http://$LOAD_IP:3000/api/health
```

#### Запуск тестов

**Вариант 1: Через SSH на Load Test Server**

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

ssh root@$LOAD_IP
cd /opt/IcebergTrinoResearch/samples-generation

# Простой тест подключения
K6_API_URL=http://localhost:3000 bash k6-run-pipe.sh k6-scripts/test-health.js

# Тест записи через API
K6_API_URL=http://localhost:3000 bash k6-run-pipe.sh k6-scripts/write-cycle.js

# Тест чтения из Trino
K6_API_URL=http://localhost:3000 bash k6-run-pipe.sh k6-scripts/trino-direct.js

# Проверка согласованности данных
K6_API_URL=http://localhost:3000 bash k6-run-pipe.sh k6-scripts/consistency-check.js

# Аналитические запросы
K6_API_URL=http://localhost:3000 bash k6-run-pipe.sh k6-scripts/analytics-queries.js

# Полная нагрузка
K6_API_URL=http://localhost:3000 K6_VUS=50 K6_DURATION=5m bash k6-run-pipe.sh k6-scripts/real-load.js
```

**Вариант 2: Локально с вашего компьютера (если установлен K6)**

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

# Из корня samples-generation
K6_API_URL=http://$LOAD_IP:3000 k6 run k6-scripts/test-health.js
K6_API_URL=http://$LOAD_IP:3000 k6 run k6-scripts/write-cycle.js --vus 10 --duration 1m
```

#### Доступные K6 скрипты

- `test-health.js` - проверка доступности API
- `test-simple.js` - простой тест
- `write-cycle.js` - тест записи через API
- `trino-direct.js` - прямые запросы к Trino
- `postgres-direct.js` - прямые запросы к PostgreSQL
- `consistency-check.js` - проверка согласованности данных
- `analytics-queries.js` - аналитические запросы
- `read-delay.js` - измерение задержек чтения
- `real-load.js` - комплексная нагрузка

Подробнее см. `k6-scripts/README.md` и `k6-scripts/COMMANDS.md`.

### 4. Мониторинг и статистика

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)

# Статистика всех таблиц
curl http://$LOAD_IP:3000/api/stats

# Статус очереди trino_queue
curl http://$LOAD_IP:3000/api/queue/status

# Количество записей в Trino
curl http://$LOAD_IP:3000/api/analytics/count
```

### 5. Доступ к Trino-FTE через SSH портфорвардинг

Для удобной работы с Trino-FTE через CLI или веб-интерфейс используйте портфорвардинг:

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Запустите SSH туннель в отдельном терминале
ssh -L 8080:$DATA_PRIVATE:8080 root@$LOAD_IP -N

# Теперь на локальном компьютере доступен Trino-FTE через http://localhost:8080
# Можно использовать Trino CLI или открыть веб-интерфейс в браузере
```

## Настройка Trino

Trino автоматически настроен под ресурсы Data Server:

- **JVM Heap**: 48GB (настраивается через `trino_heap_gb` в `terraform.tfvars`)
- **Max Direct Memory**: 8GB
- **Query Max Memory**: 40GB (heap - 8GB)
- **Task Concurrency**: 8
- **Max Worker Threads**: 32

Для изменения настроек отредактируйте `terraform.tfvars` и пересоздайте Data Server:

```bash
terraform taint openstack_compute_instance_v2.data
terraform apply
```

## Удаление инфраструктуры

Когда закончите тестирование, удалите все созданные ресурсы:

```bash
terraform destroy
```

**Внимание:** Это удалит все ВМ, диски, сети и связанные ресурсы. Данные будут потеряны!

## Troubleshooting

### SSH не подключается (требует пароль)

1. Проверьте что SSH ключ правильный:
   ```bash
   cat ~/.ssh/id_rsa_terraform.pub
   ```

2. Убедитесь что в `terraform.tfvars` указан правильный путь к публичному ключу

3. Проверьте что ключ был создан в Selectel:
   ```bash
   terraform show | grep selectel_vpc_keypair
   ```

4. Пересоздайте ключ если нужно:
   ```bash
   terraform taint selectel_vpc_keypair_v2.ssh_key
   terraform apply
   ```

### Floating IP не привязывается (или квота исчерпана)

Если видите ошибку `ExternalGatewayForFloatingIPNotFound`:
- Убедитесь что роутер создан и подключен к внешней сети
- Проверьте что `depends_on = [openstack_networking_router_interface_v2.router_if]` указан в floating-ip.tf
- Попробуйте пересоздать роутер:
  ```bash
  terraform taint openstack_networking_router_v2.router
  terraform apply
  ```

Если видите ошибку `OverQuota` для Floating IP:
- Конфигурация использует только один внешний IP для Load Test Server
- Data Server остается во внутренней сети (более безопасно)
- Если все еще не хватает квоты, удалите неиспользуемые Floating IP в панели Selectel или запросите увеличение квоты

### Сервисы не запускаются

1. Проверьте логи cloud-init на Data Server:
   ```bash
   LOAD_IP=$(terraform output -raw load_test_public_ip)
   DATA_PRIVATE=$(terraform output -raw data_server_private_ip)
   
   ssh root@$LOAD_IP "ssh root@$DATA_PRIVATE 'journalctl -u cloud-init -f'"
   ```

2. Проверьте Docker Compose на Data Server:
   ```bash
   ssh root@$LOAD_IP "ssh root@$DATA_PRIVATE 'cd /opt/IcebergTrinoResearch/samples-generation && docker compose -f compose/docker-compose.yml ps'"
   ssh root@$LOAD_IP "ssh root@$DATA_PRIVATE 'cd /opt/IcebergTrinoResearch/samples-generation && docker compose -f compose/docker-compose.yml logs'"
   ```

3. Проверьте systemd сервисы на Load Server:
   ```bash
   ssh root@$LOAD_IP 'systemctl status samples-api samples-queue-worker samples-setup'
   ssh root@$LOAD_IP 'journalctl -u samples-api -f'
   ```

### API не отвечает

1. Проверьте что API сервер запущен:
   ```bash
   ssh root@$LOAD_IP 'systemctl status samples-api'
   ```

2. Проверьте что порт 3000 открыт в security group (уже настроено автоматически)

3. Проверьте переменные окружения:
   ```bash
   ssh root@$LOAD_IP 'cat /etc/samples-generation.env'
   ```

4. Проверьте доступность Data Server из Load Test Server:
   ```bash
   LOAD_IP=$(terraform output -raw load_test_public_ip)
   DATA_PRIVATE=$(terraform output -raw data_server_private_ip)
   ssh root@$LOAD_IP "nc -zv $DATA_PRIVATE 5432"  # PostgreSQL
   ssh root@$LOAD_IP "curl -v http://$DATA_PRIVATE:8080/v1/info"  # Trino
   ssh root@$LOAD_IP "curl -v http://$DATA_PRIVATE:19120/api/v2/config"  # Nessie
   ```

## Переменные конфигурации

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `environment_name` | Суффикс для имен ресурсов | `iceberg-test` |
| `region` | Регион Selectel | - (обязательно) |
| `availability_zone` | AZ в регионе | `ru-9a` |
| `disk_type` | Тип диска (fast/universal/basic/basic_hdd) | `fast` |
| `data_flavor_id` | Flavor ID для Data Server | - (обязательно) |
| `load_flavor_id` | Flavor ID для Load Test Server | - (обязательно) |
| `data_volume_size_gb` | Размер data-тома для Data Server (GB) | `300` |
| `ssh_public_key_path` | Путь к SSH публичному ключу | `~/.ssh/id_rsa.pub` |
| `repo_url` | URL git-репозитория для деплоя | `https://github.com/newton0512/IcebergTrinoResearch.git` |
| `repo_ref` | Git branch/tag для деплоя | `terraform` |
| `repo_subdir` | Подкаталог в репозитории | `samples-generation` |
| `trino_heap_gb` | Trino JVM heap (GB) | `48` |
| `trino_max_direct_memory_gb` | Trino MaxDirectMemorySize (GB) | `8` |

Полный список переменных см. в `variables.tf`.

## Отличия от examples/selectel

Данная конфигурация расширяет пример из `examples/selectel/`:

- **Два сервера** вместо одного (Data + Load Test)
- **Автоматический деплой проекта** через cloud-init (git clone + pnpm install)
- **Docker Compose** для сервисов (Postgres/MinIO/Nessie/Trino-FTE)
- **Настройка Trino** под конкретные ресурсы сервера
- **Systemd сервисы** для API и queue-worker
- **Автоматическое создание таблиц** через oneshot service

## Firewall Rules

### Data Server (только внутренняя сеть, без внешнего IP)

- **22** (SSH) - только из приватной сети (доступ через Load Test Server)
- **8080** (Trino) - только из приватной сети (доступ извне через SSH портфорвардинг)
- **9000** (MinIO API) - только из приватной сети (доступ извне через SSH портфорвардинг)
- **9001** (MinIO Console) - только из приватной сети (доступ извне через SSH портфорвардинг)
- **19120** (Nessie) - только из приватной сети
- **5432** (PostgreSQL) - только из приватной сети

### Load Test Server (с внешним IP)

- **22** (SSH) - извне (0.0.0.0/0)
- **3000** (API) - извне (0.0.0.0/0)

Все сервисы также доступны из приватной сети между серверами.

**Безопасность:** Data Server находится во внутренней сети для защиты от внешних атак. Доступ извне осуществляется только через SSH портфорвардинг через Load Test Server.

## Дополнительные команды

### Подключение к Trino

Через SSH портфорвардинг (рекомендуется):

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Запустите туннель в отдельном терминале
ssh -L 8080:$DATA_PRIVATE:8080 root@$LOAD_IP -N

# Теперь на локальном компьютере:
curl -X POST http://localhost:8080/v1/statement \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) FROM iceberg.warehouse.bonus_registry"}'
```

Через Load Test Server (из внутренней сети):

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

ssh root@$LOAD_IP "curl -X POST http://$DATA_PRIVATE:8080/v1/statement \
  -H 'Content-Type: application/json' \
  -d '{\"query\": \"SELECT COUNT(*) FROM iceberg.warehouse.bonus_registry\"}'"
```

Или установите Trino CLI локально для удобной работы с Trino-FTE (используйте `http://localhost:8080` после запуска SSH туннеля).

### Просмотр логов сервисов

```bash
LOAD_IP=$(terraform output -raw load_test_public_ip)
DATA_PRIVATE=$(terraform output -raw data_server_private_ip)

# Docker Compose логи на Data Server
ssh root@$LOAD_IP "ssh root@$DATA_PRIVATE 'cd /opt/IcebergTrinoResearch/samples-generation && docker compose -f compose/docker-compose.yml logs -f'"

# API логи на Load Test Server
ssh root@$LOAD_IP 'journalctl -u samples-api -f'

# Queue Worker логи
ssh root@$LOAD_IP 'journalctl -u samples-queue-worker -f'
```

## Следующие шаги

После успешного развертывания:

1. **Создайте таблицы** (если не создались автоматически)
2. **Заполните данными** через `write-trino-mass.ts` или API
3. **Запустите нагрузочные тесты** через K6
4. **Проанализируйте результаты** и оптимизируйте конфигурацию

Подробнее о работе с проектом см. `../README.md` и `../k6-scripts/README.md`.
