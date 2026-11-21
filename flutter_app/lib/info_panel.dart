import 'package:flutter/material.dart';

import 'scene/scene.dart';

/// Attribution and honesty notes for the current scene: OpenStreetMap, the Copernicus DEM string exactly as in the
/// terrain tile metadata, and what the building heights are. Plain text (no links are opened; the app makes no
/// network calls).
class InfoPanel extends StatelessWidget {
  final Scene scene;
  const InfoPanel({super.key, required this.scene});

  static Future<void> show(BuildContext context, Scene scene) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => InfoPanel(scene: scene),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.7),
        child: ListView(
          key: const Key('info-panel'),
          padding: const EdgeInsets.all(16),
          shrinkWrap: true,
          children: [
            Text('About this map', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('Pre-trip preview only. It is never synced to live GPS.', style: theme.textTheme.bodySmall),
            for (final a in scene.attributions) ...[
              const SizedBox(height: 14),
              Text(a.title, style: theme.textTheme.labelLarge),
              const SizedBox(height: 2),
              SelectableText(a.text, style: theme.textTheme.bodyMedium),
            ],
          ],
        ),
      ),
    );
  }
}
