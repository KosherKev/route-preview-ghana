import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/style/building_height.dart';

import 'support/style_expr.dart';

Map<String, dynamic> _buildingsLayer() {
  final style = jsonDecode(File('assets/style/route_preview_style.json').readAsStringSync()) as Map<String, dynamic>;
  return (style['layers'] as List).cast<Map<String, dynamic>>().firstWhere((l) => l['id'] == 'buildings-3d');
}

void main() {
  group('reference function', () {
    test('real heights pass through, never marked as estimates', () {
      expect(buildingHeight(heightSource: 'height', height: '12', featureId: 1), const BuildingHeight(12, isEstimate: false));
      expect(buildingHeight(heightSource: 'height', height: '12.5', featureId: 1).meters, 12.5);
      expect(buildingHeight(heightSource: 'height', height: ' 40 ', featureId: 99).meters, 40);
      expect(buildingHeight(heightSource: 'height', height: '100', featureId: 7).isEstimate, isFalse);
    });

    test('levels are 3 m each', () {
      expect(buildingHeight(heightSource: 'levels', levels: '1', featureId: 5), const BuildingHeight(3, isEstimate: false));
      expect(buildingHeight(heightSource: 'levels', levels: '5', featureId: 5).meters, 15);
      expect(buildingHeight(heightSource: 'levels', levels: '2.5', featureId: 5).meters, 7.5);
      expect(kLevelHeightM, 3.0);
    });

    test('unusable tag values fall through to the estimate, flagged', () {
      for (final bad in ["30'", '0', '-4', '', 'tall', '2-3', '12 m', 'NaN']) {
        final h = buildingHeight(heightSource: 'height', height: bad, featureId: 12345);
        expect(h.isEstimate, isTrue, reason: "height '$bad'");
        expect(h.meters, 5);
        final l = buildingHeight(heightSource: 'levels', levels: bad, featureId: 12345);
        expect(l.isEstimate, isTrue, reason: "levels '$bad'");
      }
      expect(buildingHeight(heightSource: 'height', height: null, featureId: 1).isEstimate, isTrue);
    });

    test('default buildings get the estimate; it ignores any height or levels tag', () {
      final h = buildingHeight(heightSource: 'default', height: '99', levels: '30', featureId: 100);
      expect(h, const BuildingHeight(14, isEstimate: true));
      expect(buildingHeight(heightSource: null, featureId: 100).isEstimate, isTrue);
      expect(buildingHeight(heightSource: 'something-else', height: '50', featureId: 100).isEstimate, isTrue);
    });

    test('the estimate is deterministic and matches independently computed values', () {
      const golden = {
        0: 4, 1: 7, 2: 9, 3: 11, 100: 14, 1009: 4, 12345: 5, 987654321: 14, 1234567890123: 13, 1000000000000000: 12,
      };
      golden.forEach((id, want) {
        expect(estimateHeightM(id), want.toDouble(), reason: 'id $id');
        expect(estimateHeightM(id), estimateHeightM(id), reason: 'repeatable');
      });
    });

    test('the estimate stays within 4 to 14 m, is whole metres, and uses the whole range', () {
      final seen = <double>{};
      for (var id = 0; id < 20000; id++) {
        final e = estimateHeightM(id);
        expect(e, inInclusiveRange(kEstimateMinM, kEstimateMaxM));
        expect(e, e.roundToDouble());
        seen.add(e);
      }
      expect(seen.length, 11);
      expect(kEstimateMinM, 4);
      expect(kEstimateMaxM, 14);
    });

    test('the estimate is never applied when real data is usable (any id)', () {
      for (var id = 0; id < 3000; id++) {
        expect(buildingHeight(heightSource: 'height', height: '33', featureId: id).meters, 33);
        expect(buildingHeight(heightSource: 'levels', levels: '4', featureId: id).meters, 12);
      }
    });
  });

  group('the real style expression agrees with the reference function', () {
    final heightExpr = _buildingsLayer()['paint']['fill-extrusion-height'];

    double styleHeight(Map<String, Object?> props, int id) => (evalExpr(heightExpr, props: props, id: id) as num).toDouble();

    test('over real-looking and messy tag values and many feature ids', () {
      final sources = <String?>['height', 'levels', 'default', null, 'other'];
      final values = <String?>[null, '12', '12.5', '3', '0', '-2', '', ' 8 ', "30'", '2-3', 'tall', '100', '1e1'];
      var cases = 0;
      for (final hs in sources) {
        for (final h in values) {
          for (final lv in values) {
            for (final id in [0, 1, 2, 7, 100, 1009, 12345, 987654321, 1234567890123]) {
              final props = <String, Object?>{
                'height_source': ?hs,
                'height': ?h,
                'building:levels': ?lv,
              };
              final ref = buildingHeight(heightSource: hs, height: h, levels: lv, featureId: id);
              expect(styleHeight(props, id), ref.meters, reason: 'hs=$hs height=$h levels=$lv id=$id');
              cases++;
            }
          }
        }
      }
      expect(cases, greaterThan(5000));
    });

    test('a default building is an estimate inside 4 to 14 m for every id, and stable', () {
      for (var id = 1; id <= 5000; id++) {
        final h = styleHeight({'height_source': 'default'}, id);
        expect(h, inInclusiveRange(4, 14));
        expect(h, styleHeight({'height_source': 'default'}, id));
      }
    });

    test('the colour expression uses the same height as the extrusion (so tint and height cannot disagree)', () {
      final color = _buildingsLayer()['paint']['fill-extrusion-color'] as List;
      expect(color.first, 'let');
      expect(color[1], 'h');
      expect(jsonEncode(color[2]), jsonEncode(heightExpr));
    });

    test('the evaluator refuses operators it does not know (so the style cannot hide an unchecked one)', () {
      expect(() => evalExpr(['area'], props: const {}), throwsUnsupportedError);
    });
  });
}
