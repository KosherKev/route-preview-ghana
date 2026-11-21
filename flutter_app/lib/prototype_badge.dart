import 'package:flutter/material.dart';

/// The "PROTOTYPE" badge shown whenever the manifest says `prototype: true` (street imagery and clips are prototype-only, D1).
class PrototypeBadge extends StatelessWidget {
  const PrototypeBadge({super.key});

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: const Color(0xFFFFC857), borderRadius: BorderRadius.circular(6)),
        child: const Text('PROTOTYPE', style: TextStyle(color: Colors.black, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.6)),
      );
}
