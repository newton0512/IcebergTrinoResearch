resource "openstack_compute_instance_v2" "servers" {
  count = 2

  name = count.index == 0 ? "data-server" : "load-test-server"

  image_id  = data.openstack_images_image_v2.ubuntu.id
  flavor_id = count.index == 0 ? var.data_flavor_id : var.load_flavor_id
  key_pair  = selectel_vpc_keypair_v2.ssh_key.name

  network {
    port = openstack_networking_port_v2.ports[count.index].id
  }

  block_device {
    uuid                  = data.openstack_images_image_v2.ubuntu.id
    source_type           = "image"
    destination_type      = "volume"
    volume_size           = count.index == 0 ? 300 : 50
    delete_on_termination = true
  }


  vendor_options {
    ignore_resize_confirmation = true
  }

  # Cloud-init configuration
  user_data = count.index == 0 ? file("cloud-init-data-server.yaml") : file("cloud-init-load-test.yaml")
}