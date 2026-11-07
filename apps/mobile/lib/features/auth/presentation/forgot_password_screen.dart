import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/auth_failure.dart';
import '../domain/email.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';
import 'turnstile_field.dart';

/// Password recovery request (spec 03). Same message for every address.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  AuthFailure? _emailError;
  AuthFailure? _formError;
  String? _captcha;
  int _captchaReset = 0;
  bool _sent = false;
  bool _pending = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = normalizeEmail(_email.text);
    setState(() {
      _formError = null;
      _emailError = email == null ? AuthFailure.invalidEmail : null;
    });
    if (email == null) return;
    final repository = ref.read(authRepositoryProvider);
    if (repository == null) {
      setState(() => _formError = AuthFailure.notConfigured);
      return;
    }
    if (TurnstileField.isEnabled(ref) && _captcha == null) {
      setState(() => _formError = AuthFailure.captchaRequired);
      return;
    }
    setState(() => _pending = true);
    final failure = await repository.requestPasswordReset(
      email,
      captchaToken: _captcha,
    );
    if (!mounted) return;
    setState(() {
      _pending = false;
      _captcha = null;
      _captchaReset++;
      _formError = failure;
      _sent = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AuthMessages.of(context);
    return AuthScaffold(
      brand: t.brand,
      title: t.forgotTitle,
      subtitle: _sent ? null : t.forgotSubtitle,
      children: [
        if (_sent)
          AuthMessageText(t.forgotSent)
        else ...[
          TextField(
            key: const Key('forgot-email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            textDirection: TextDirection.ltr,
            onSubmitted: (_) => _submit(),
            decoration: InputDecoration(
              labelText: t.email,
              hintText: t.emailPlaceholder,
              errorText: _emailError == null ? null : t.error(_emailError!),
            ),
          ),
          const SizedBox(height: AppSpacing.s4),
          TurnstileField(
            resetKey: _captchaReset,
            onToken: (token) => setState(() => _captcha = token),
          ),
          if (_formError != null)
            AuthMessageText(t.error(_formError!), isError: true),
          FilledButton(
            key: const Key('forgot-submit'),
            onPressed: _pending ? null : _submit,
            child: Text(t.submitForgot),
          ),
        ],
        const SizedBox(height: AppSpacing.s3),
        TextButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: Text(t.toLogin),
        ),
      ],
    );
  }
}
