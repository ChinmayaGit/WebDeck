import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Named glyphs runtime apps can use as their icon (`"icon"` in webdeck.json).
/// Kept as a fixed const map so Flutter's icon tree-shaking still works.
class AppGlyphs {
  static const Map<String, IconData> glyphs = {
    'app': Icons.apps_rounded,
    'image': Icons.image_rounded,
    'photo': Icons.photo_library_rounded,
    'video': Icons.smart_display_rounded,
    'movie': Icons.movie_rounded,
    'music': Icons.music_note_rounded,
    'download': Icons.download_rounded,
    'price': Icons.sell_rounded,
    'chart': Icons.show_chart_rounded,
    'ticket': Icons.confirmation_number_rounded,
    'game': Icons.sports_esports_rounded,
    'gift': Icons.redeem_rounded,
    'doc': Icons.description_rounded,
    'pdf': Icons.picture_as_pdf_rounded,
    'convert': Icons.transform_rounded,
    'bell': Icons.notifications_active_rounded,
    'eye': Icons.visibility_rounded,
    'calendar': Icons.calendar_month_rounded,
    'note': Icons.sticky_note_2_rounded,
    'code': Icons.code_rounded,
    'tool': Icons.build_rounded,
    'globe': Icons.public_rounded,
    'cart': Icons.shopping_cart_rounded,
    'rss': Icons.rss_feed_rounded,
  };

  static IconData of(String name) => glyphs[name] ?? Icons.apps_rounded;

  static Color parseColor(String hex, [Color fallback = const Color(0xFF388BFD)]) {
    var h = hex.trim().replaceFirst('#', '');
    if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
    if (h.length == 6) h = 'FF$h';
    final v = int.tryParse(h, radix: 16);
    return v == null ? fallback : Color(v);
  }

  /// Renders the glyph on a rounded gradient tile as a PNG (for app cards / registry).
  static Future<Uint8List> renderPng(String glyph, String colorHex, {double size = 256}) async {
    final color = parseColor(colorHex);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final rect = Rect.fromLTWH(0, 0, size, size);
    final hsl = HSLColor.fromColor(color);
    final paint = Paint()
      ..shader = ui.Gradient.linear(
        rect.topLeft,
        rect.bottomRight,
        [
          hsl.withLightness((hsl.lightness + 0.08).clamp(0.0, 1.0)).toColor(),
          hsl.withLightness((hsl.lightness - 0.14).clamp(0.0, 1.0)).toColor(),
        ],
      );
    canvas.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(size * 0.22)), paint);

    final icon = of(glyph);
    final tp = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(
          fontSize: size * 0.56,
          fontFamily: icon.fontFamily,
          package: icon.fontPackage,
          color: Colors.white,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset((size - tp.width) / 2, (size - tp.height) / 2));

    final image = await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return bytes!.buffer.asUint8List();
  }
}

/// Native widget version of an app glyph tile.
class AppGlyphTile extends StatelessWidget {
  final String glyph;
  final String color;
  final double size;

  const AppGlyphTile({super.key, required this.glyph, required this.color, this.size = 48});

  @override
  Widget build(BuildContext context) {
    final c = AppGlyphs.parseColor(color);
    final hsl = HSLColor.fromColor(c);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            hsl.withLightness((hsl.lightness + 0.08).clamp(0.0, 1.0)).toColor(),
            hsl.withLightness((hsl.lightness - 0.14).clamp(0.0, 1.0)).toColor(),
          ],
        ),
      ),
      child: Icon(AppGlyphs.of(glyph), color: Colors.white, size: size * 0.56),
    );
  }
}
