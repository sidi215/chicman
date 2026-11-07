import 'package:flutter/material.dart';

import '../app_theme.dart';

/// The Chicman wordmark (brand logo), tinted with the theme's text colour so
/// it follows light and dark mode. Asset and height come from the design
/// tokens (`AppBrand.wordmarkAsset`, `AppSizes.brandWordmark`).
class BrandWordmark extends StatelessWidget {
  const BrandWordmark({
    super.key,
    required this.semanticLabel,
    this.height = AppSizes.brandWordmark,
  });

  /// Spoken by screen readers, for example "Chicman" or "شيكمان".
  final String semanticLabel;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      AppBrand.wordmarkAsset,
      height: height,
      width: height * AppBrand.wordmarkAspectRatio,
      color: Theme.of(context).colorScheme.onSurface,
      colorBlendMode: BlendMode.srcIn,
      semanticLabel: semanticLabel,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
    );
  }
}
