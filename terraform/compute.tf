resource "openstack_blockstorage_volume_v3" "data_boot" {
  name              = "iceberg-data-boot-${var.environment_name}"
  size              = var.data_boot_disk_size_gb
  image_id          = data.openstack_images_image_v2.ubuntu.id
  volume_type       = "${var.disk_type}.${var.availability_zone}"
  availability_zone = var.availability_zone
}

resource "openstack_blockstorage_volume_v3" "load_boot" {
  name              = "iceberg-load-boot-${var.environment_name}"
  size              = var.load_boot_disk_size_gb
  image_id          = data.openstack_images_image_v2.ubuntu.id
  volume_type       = "${var.disk_type}.${var.availability_zone}"
  availability_zone = var.availability_zone
}

resource "openstack_blockstorage_volume_v3" "data_volume" {
  name              = "iceberg-data-volume-${var.environment_name}"
  size              = var.data_volume_size_gb
  volume_type       = "${var.disk_type}.${var.availability_zone}"
  availability_zone = var.availability_zone
}

resource "openstack_compute_instance_v2" "data" {
  name              = "data-server-${var.environment_name}"
  flavor_id         = var.data_flavor_id
  key_pair          = selectel_vpc_keypair_v2.ssh_key.name
  availability_zone = var.availability_zone

  user_data = templatefile("${path.module}/cloud-init-data-server.yaml.tftpl", {
    repo_url                   = var.repo_url
    repo_ref                   = var.repo_ref
    repo_subdir                = var.repo_subdir
    trino_heap_gb              = var.trino_heap_gb
    trino_max_direct_memory_gb = var.trino_max_direct_memory_gb
  })

  network {
    port = openstack_networking_port_v2.data.id
  }

  # Boot from volume
  block_device {
    uuid                  = openstack_blockstorage_volume_v3.data_boot.id
    source_type           = "volume"
    destination_type      = "volume"
    boot_index            = 0
    delete_on_termination = true
  }

  # Extra data volume (for MinIO/Postgres/Nessie data)
  block_device {
    uuid                  = openstack_blockstorage_volume_v3.data_volume.id
    source_type           = "volume"
    destination_type      = "volume"
    boot_index            = 1
    delete_on_termination = true
  }

  lifecycle {
    ignore_changes = [image_id]
  }

  vendor_options {
    ignore_resize_confirmation = true
  }

  depends_on = [openstack_networking_router_interface_v2.router_if]
}

resource "openstack_compute_instance_v2" "load" {
  name              = "load-test-server-${var.environment_name}"
  flavor_id         = var.load_flavor_id
  key_pair          = selectel_vpc_keypair_v2.ssh_key.name
  availability_zone = var.availability_zone

  user_data = templatefile("${path.module}/cloud-init-load-test.yaml.tftpl", {
    repo_url               = var.repo_url
    repo_ref               = var.repo_ref
    repo_subdir            = var.repo_subdir
    data_server_private_ip = openstack_compute_instance_v2.data.access_ip_v4
  })

  network {
    port = openstack_networking_port_v2.load.id
  }

  block_device {
    uuid                  = openstack_blockstorage_volume_v3.load_boot.id
    source_type           = "volume"
    destination_type      = "volume"
    boot_index            = 0
    delete_on_termination = true
  }

  lifecycle {
    ignore_changes = [image_id]
  }

  vendor_options {
    ignore_resize_confirmation = true
  }

  depends_on = [openstack_networking_router_interface_v2.router_if]
}