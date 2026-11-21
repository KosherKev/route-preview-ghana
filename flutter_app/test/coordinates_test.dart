import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/request/coordinates.dart';

void main() {
  group('parseDecimal', () {
    test('plain decimals', () {
      expect(parseDecimal('5.6037'), 5.6037);
      expect(parseDecimal(' -0.1870 '), -0.187);
      expect(parseDecimal('+5'), 5);
      expect(parseDecimal('.5'), 0.5);
      expect(parseDecimal('7.'), 7);
    });
    test('rejects everything else', () {
      for (final bad in ['', ' ', 'abc', '5,6037', '5.6.3', '1e3', '0x10', 'NaN', 'Infinity', '--1', '5 6', '5.6037N']) {
        expect(parseDecimal(bad), isNull, reason: bad);
      }
    });
  });

  group('latitude', () {
    test('Ghana latitudes pass, including the edges of the box', () {
      for (final v in ['5.6037', '4.5', '11.3', '9.4', '5.56']) {
        expect(validateLat(v), isNull, reason: v);
      }
    });
    test('clear messages for each kind of mistake', () {
      expect(validateLat(''), 'Enter a latitude');
      expect(validateLat('north'), contains('must be a number'));
      expect(validateLat('91'), contains('between -90 and 90'));
      expect(validateLat('51.5'), contains('outside Ghana'));
      expect(validateLat('-0.187'), contains('outside Ghana'), reason: 'a longitude typed into the latitude box');
      expect(validateLat('4.4'), contains('outside Ghana'));
      expect(validateLat('11.4'), contains('outside Ghana'));
    });
  });

  group('longitude', () {
    test('Ghana longitudes pass', () {
      for (final v in ['-0.1870', '-3.3', '1.2', '0', '-2.5']) {
        expect(validateLon(v), isNull, reason: v);
      }
    });
    test('clear messages, including the dropped minus sign', () {
      expect(validateLon(''), 'Enter a longitude');
      expect(validateLon('west'), contains('must be a number'));
      expect(validateLon('181'), contains('between -180 and 180'));
      expect(validateLon('2.5'), allOf(contains('outside Ghana'), contains('minus sign')));
      expect(validateLon('-3.5'), contains('outside Ghana'));
      expect(validateLon('5.6037'), contains('outside Ghana'), reason: 'a latitude typed into the longitude box');
    });
  });

  test('parseLatLon needs both valid', () {
    final ok = parseLatLon('5.6037', '-0.1870')!;
    expect((ok.lat, ok.lon), (5.6037, -0.187));
    expect(parseLatLon('5.6037', 'x'), isNull);
    expect(parseLatLon('0', '-0.187'), isNull);
  });
}
