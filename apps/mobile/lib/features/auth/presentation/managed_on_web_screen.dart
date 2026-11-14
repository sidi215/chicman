import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/auth_providers.dart';
import '../domain/session_check.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';

/// The text for an account the mobile app does not serve (AT-1, Q5).
String webOnlyText(AuthMessages t, String accountType) =>
    accountType == AccountTypes.admin ? t.webOnlyAdmin : t.webOnlySeller;

/// What a Seller or Administrator account sees in the mobile app (AT-1, Q5):
/// the app is for buyers only; these accounts are managed on the web. Only
/// sign-out is offered, and no buyer screen is reachable.
class ManagedOnWebScreen extends ConsumerWidget {
  const ManagedOnWebScreen({super.key, required this.accountType});

  final String accountType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AuthMessages.of(context);
    return AuthScaffold(
      key: const Key('managed-on-web'),
      brand: t.brand,
      title: t.webOnlyTitle,
      children: [
        AuthMessageText(webOnlyText(t, accountType)),
        FilledButton.tonal(
          key: const Key('managed-on-web-logout'),
          onPressed: () => ref.read(authRepositoryProvider)?.signOut(),
          child: Text(t.logout),
        ),
      ],
    );
  }
}
