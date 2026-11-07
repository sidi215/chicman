import 'dart:async';

import 'package:app_links/app_links.dart';

/// Incoming App Links / Universal Links, including the link that launched
/// the app. Links are never logged (they may carry a token).
Stream<Uri> appLinkStream() async* {
  final appLinks = AppLinks();
  try {
    final initial = await appLinks.getInitialLink();
    if (initial != null) yield initial;
  } on Object {
    // No initial link on this platform.
  }
  yield* appLinks.uriLinkStream;
}
