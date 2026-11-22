import 'dart:io';

/// Where a resolved API address lives, for the connection diagnostic only (nothing here changes how a request is made).
enum AddressKind {
  /// Tailscale's CGNAT range 100.64.0.0/10 (and Tailscale's IPv6 range, which sits inside fc00::/7).
  tailnet,

  /// Private LAN, loopback or link-local: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10.
  privateLan,

  /// Anything else: reachable from the open internet, so not a tailnet address.
  public,
}

/// Said when an address is neither tailnet nor private. Plain words, shown under the timing line.
const String kPublicAddressWarning = 'This looks like a public address. The API is only reachable inside Tailscale.';

/// How many resolved addresses the diagnostic shows.
const int kShownAddresses = 3;

AddressKind classifyAddress(InternetAddress a) {
  final b = a.rawAddress;
  if (a.type == InternetAddressType.IPv4 && b.length == 4) return _classifyV4(b);
  if (b.length == 16) {
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
    final mapped = b.sublist(0, 10).every((x) => x == 0) && b[10] == 0xff && b[11] == 0xff;
    if (mapped) return _classifyV4(b.sublist(12));
    if (b.sublist(0, 15).every((x) => x == 0) && b[15] == 1) return AddressKind.privateLan; // ::1
    if (b[0] == 0xfd && b[1] == 0x7a && b[2] == 0x11 && b[3] == 0x5c && b[4] == 0xa1 && b[5] == 0xe0) return AddressKind.tailnet;
    if ((b[0] & 0xfe) == 0xfc) return AddressKind.privateLan; // fc00::/7 unique local
    if (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) return AddressKind.privateLan; // fe80::/10 link-local
  }
  return AddressKind.public;
}

AddressKind _classifyV4(List<int> b) {
  if (b[0] == 100 && (b[1] & 0xc0) == 64) return AddressKind.tailnet; // 100.64.0.0/10
  if (b[0] == 10) return AddressKind.privateLan;
  if (b[0] == 172 && (b[1] & 0xf0) == 16) return AddressKind.privateLan;
  if (b[0] == 192 && b[1] == 168) return AddressKind.privateLan;
  if (b[0] == 127) return AddressKind.privateLan;
  if (b[0] == 169 && b[1] == 254) return AddressKind.privateLan;
  return AddressKind.public;
}

/// [kPublicAddressWarning] when any of [addresses] is public, else null.
String? addressWarning(List<InternetAddress> addresses) =>
    addresses.any((a) => classifyAddress(a) == AddressKind.public) ? kPublicAddressWarning : null;

/// `resolved to 100.101.2.3` or `resolved to a, b, c (+2 more)`: the first [kShownAddresses] addresses.
String resolvedLine(List<InternetAddress> addresses) {
  final shown = addresses.take(kShownAddresses).map((a) => a.address).join(', ');
  final more = addresses.length - kShownAddresses;
  return 'resolved to $shown${more > 0 ? ' (+$more more)' : ''}';
}
