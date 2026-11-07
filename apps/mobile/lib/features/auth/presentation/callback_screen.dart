import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/email_link.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';
import 'forgot_password_screen.dart';
import 'register_screen.dart';

/// Verifies a confirmation or recovery link opened in the app (spec 03).
/// Runs once per link, goes to a fixed destination, and never logs the token.
class CallbackScreen extends ConsumerStatefulWidget {
  const CallbackScreen({super.key, required this.incoming});

  final IncomingLink incoming;

  @override
  ConsumerState<CallbackScreen> createState() => _CallbackScreenState();
}

class _CallbackScreenState extends ConsumerState<CallbackScreen> {
  bool _invalid = false;
  EmailLinkType? _type;

  @override
  void initState() {
    super.initState();
    Future.microtask(_verify);
  }

  Future<void> _verify() async {
    final incoming = widget.incoming;
    final repository = ref.read(authRepositoryProvider);
    if (incoming is! ValidEmailLink || repository == null) {
      if (mounted) setState(() => _invalid = true);
      return;
    }
    _type = incoming.link.type;
    final failure = await repository.verifyEmailLink(incoming.link);
    if (!mounted) return;
    if (failure != null) {
      setState(() => _invalid = true);
      return;
    }
    if (incoming.link.type == EmailLinkType.recovery) {
      ref.read(passwordRecoveryProvider.notifier).start();
    }
    // The gate now shows the account (setup) or the new-password screen.
    ref.read(pendingEmailLinkProvider.notifier).clear();
  }

  void _leave(Widget? next) {
    ref.read(pendingEmailLinkProvider.notifier).clear();
    if (next != null) {
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => next));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AuthMessages.of(context);
    if (!_invalid) {
      return AuthScaffold(
        brand: t.brand,
        title: t.callbackTitle,
        children: [AuthMessageText(t.callbackWorking)],
      );
    }
    final recovery = _type == EmailLinkType.recovery;
    return AuthScaffold(
      brand: t.brand,
      title: t.linkInvalidTitle,
      subtitle: t.linkInvalidBody,
      children: [
        AuthMessageText(
          recovery ? t.linkInvalidRecoveryHint : t.linkInvalidConfirmHint,
        ),
        if (recovery)
          FilledButton(
            key: const Key('callback-forgot'),
            onPressed: () => _leave(const ForgotPasswordScreen()),
            child: Text(t.toForgot),
          )
        else ...[
          FilledButton(
            key: const Key('callback-login'),
            onPressed: () => _leave(null),
            child: Text(t.toLogin),
          ),
          const SizedBox(height: AppSpacing.s2),
          TextButton(
            onPressed: () => _leave(const RegisterScreen()),
            child: Text(t.resendConfirmation),
          ),
        ],
      ],
    );
  }
}
