/// Latitude/longitude text parsing for the route request form.
///
/// Ghana bounding box sanity check: a generous box around the country, so a typo (swapped fields, a missing minus
/// sign, a value in the wrong hemisphere) gets a clear message, while any place in Ghana passes. The server still does
/// the authoritative check; this only saves a round trip.
const double kGhanaMinLat = 4.5, kGhanaMaxLat = 11.3;
const double kGhanaMinLon = -3.4, kGhanaMaxLon = 1.3;

class LatLonValue {
  final double lat;
  final double lon;
  const LatLonValue(this.lat, this.lon);
}

/// Parses a plain decimal number; null when it is not one. Accepts a comma as the decimal separator is NOT supported
/// (it is ambiguous with a coordinate pair), and rejects NaN, infinity, hex and exponent forms with junk.
double? parseDecimal(String raw) {
  final s = raw.trim();
  if (s.isEmpty) return null;
  if (!RegExp(r'^[+-]?(\d+(\.\d*)?|\.\d+)$').hasMatch(s)) return null;
  final v = double.tryParse(s);
  return (v == null || !v.isFinite) ? null : v;
}

/// Null when valid, else a message for the user.
String? validateLat(String raw) {
  final v = parseDecimal(raw);
  if (raw.trim().isEmpty) return 'Enter a latitude';
  if (v == null) return 'Latitude must be a number like 5.6037';
  if (v < -90 || v > 90) return 'Latitude must be between -90 and 90';
  if (v < kGhanaMinLat || v > kGhanaMaxLat) {
    return 'Latitude $v is outside Ghana (about $kGhanaMinLat to $kGhanaMaxLat). Check the numbers are not swapped.';
  }
  return null;
}

String? validateLon(String raw) {
  final v = parseDecimal(raw);
  if (raw.trim().isEmpty) return 'Enter a longitude';
  if (v == null) return 'Longitude must be a number like -0.1870';
  if (v < -180 || v > 180) return 'Longitude must be between -180 and 180';
  if (v < kGhanaMinLon || v > kGhanaMaxLon) {
    return 'Longitude $v is outside Ghana (about $kGhanaMinLon to $kGhanaMaxLon). Ghana is just west of 0: did you drop the minus sign?';
  }
  return null;
}

/// Both parsed, or null when either is invalid.
LatLonValue? parseLatLon(String lat, String lon) {
  if (validateLat(lat) != null || validateLon(lon) != null) return null;
  return LatLonValue(parseDecimal(lat)!, parseDecimal(lon)!);
}
