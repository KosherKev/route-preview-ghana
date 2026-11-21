import 'dart:convert';

/// Builds the runtime style from the committed template (assets/style/route_preview_style.json).
///
/// The template is valid JSON with placeholders: `{{VECTOR_TILES_URL}}` and `{{TERRAIN_TILES_URL}}` (substituted inside
/// strings) and `{{ROUTE_GEOJSON}}`, `{{ROUTE_DONE_GEOJSON}}`, `{{DESTINATION_GEOJSON}}` (a whole string value that is
/// replaced by a GeoJSON object). Substitution walks the parsed JSON, so a path with special characters cannot break the
/// style, and no text is ever pasted into JSON.
class RoutePreviewStyle {
  static const String asset = 'assets/style/route_preview_style.json';

  static const String vectorUrlPlaceholder = '{{VECTOR_TILES_URL}}';
  static const String terrainUrlPlaceholder = '{{TERRAIN_TILES_URL}}';
  static const String routePlaceholder = '{{ROUTE_GEOJSON}}';
  static const String routeDonePlaceholder = '{{ROUTE_DONE_GEOJSON}}';
  static const String destinationPlaceholder = '{{DESTINATION_GEOJSON}}';

  static const Set<String> placeholders = {
    vectorUrlPlaceholder,
    terrainUrlPlaceholder,
    routePlaceholder,
    routeDonePlaceholder,
    destinationPlaceholder,
  };

  static const Map<String, dynamic> emptyCollection = {'type': 'FeatureCollection', 'features': <dynamic>[]};

  /// Returns the style as a JSON string. With [hillshade] false the hillshade layer is hidden (`visibility: none`).
  static String build(
    String template, {
    required String vectorUrl,
    required String terrainUrl,
    required Map<String, dynamic> route,
    Map<String, dynamic> routeDone = emptyCollection,
    required Map<String, dynamic> destination,
    bool hillshade = true,
  }) {
    final objects = {
      routePlaceholder: route,
      routeDonePlaceholder: routeDone,
      destinationPlaceholder: destination,
    };
    Object? walk(Object? node) {
      if (node is String) {
        if (objects.containsKey(node)) return objects[node];
        return node.replaceAll(vectorUrlPlaceholder, vectorUrl).replaceAll(terrainUrlPlaceholder, terrainUrl);
      }
      if (node is List) return [for (final e in node) walk(e)];
      if (node is Map) return <String, dynamic>{for (final e in node.entries) e.key as String: walk(e.value)};
      return node;
    }

    final style = walk(jsonDecode(template)) as Map<String, dynamic>;
    if (!hillshade) {
      for (final layer in style['layers'] as List) {
        if ((layer as Map)['id'] == 'hillshade') {
          layer['layout'] = {...(layer['layout'] as Map? ?? const {}), 'visibility': 'none'};
        }
      }
    }
    return jsonEncode(style);
  }
}
