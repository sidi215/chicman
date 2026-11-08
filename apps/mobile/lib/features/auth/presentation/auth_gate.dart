import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/auth_providers.dart';
import '../domain/email_link.dart';
import 'account_screen.dart';
import 'callback_screen.dart';
import 'login_screen.dart';
import 'update_password_screen.dart';

/// Routes between auth states:
/// - an incoming email link → [CallbackScreen];
/// - signed in after a recovery link → [UpdatePasswordScreen];
/// - signed in → [AccountScreen] (account setup when not bootstrapped);
/// - signed out → [LoginScreen].
///
/// It stays mounted while [visible] is false, so it keeps receiving email
/// links, but it builds no account or login screen until it is shown.
class AuthGate extends ConsumerStatefulWidget {
  const AuthGate({super.key, this.visible = true});

  final bool visible;

  @override
  ConsumerState<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends ConsumerState<AuthGate> {
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    final links = ref.read(incomingLinksProvider);
    final host = ref.read(appConfigProvider).appLinkHost;
    _links = links?.listen((uri) {
      final incoming = parseIncomingLink(uri, host: host);
      if (incoming is NotAuthCallback || !mounted) return;
      // A link opened over a pushed screen (register, forgot password)
      // returns to the gate, which shows the callback.
      Navigator.of(context).popUntil((route) => route.isFirst);
      ref.read(pendingEmailLinkProvider.notifier).receive(incoming);
    });
  }

  @override
  void dispose() {
    _links?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pending = ref.watch(pendingEmailLinkProvider);
    if (pending != null) {
      return CallbackScreen(key: ObjectKey(pending), incoming: pending);
    }
    if (!widget.visible) return const SizedBox.shrink();
    final recovering = ref.watch(passwordRecoveryProvider);
    final session = ref.watch(authSessionProvider);
    return switch (session) {
      AsyncData(value: != null) when recovering => const UpdatePasswordScreen(),
      AsyncData(value: final value?) => AccountScreen(session: value),
      AsyncData() || AsyncError() => const LoginScreen(),
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }
}
