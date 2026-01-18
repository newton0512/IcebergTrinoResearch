resource "selectel_vpc_keypair_v2" "ssh_key" {
  name       = "default-ssh-key"
  public_key = file("~/.ssh/id_rsa_terraform.pub")
  user_id    = var.service_user_id
}