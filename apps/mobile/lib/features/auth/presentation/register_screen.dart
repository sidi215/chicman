import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/auth_failure.dart';
import '../domain/email.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';
import 'turnstile_field.dart';

/// Sign-up: email and password only (spec 03). The phone number is collected
/// at account setup, after the email is confirmed.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  AuthFailure? _emailError;
  AuthFailure? _passwordError;
  AuthFailure? _confirmError;
  AuthFailure? _formError;
  String? _info;
  String? _sentTo;
  String? _captcha;
  int _captchaReset = 0;
  bool _pending = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  bool get _captchaBlocks => TurnstileField.isEnabled(ref) && _captcha == null;

  void _resetCaptcha() => setState(() {
    _captcha = null;
    _captchaReset++;
  });

  Future<void> _submit() async {
    final email = normalizeEmail(_email.text);
    setState(() {
      _formError = null;
      _emailError = email == null ? AuthFailure.invalidEmail : null;
      _passwordError = _password.text.isEmpty
          ? AuthFailure.passwordRequired
          : null;
      _confirmError = _passwordError == null && _password.text != _confirm.text
          ? AuthFailure.passwordMismatch
          : null;
    });
    if (email == null || _passwordError != null || _confirmError != null) {
      return;
    }
    final repository = ref.read(authRepositoryProvider);
    if (repository == null) {
      setState(() => _formError = AuthFailure.notConfigured);
      return;
    }
    if (_captchaBlocks) {
      setState(() => _formError = AuthFailure.captchaRequired);
      return;
    }
    setState(() => _pending = true);
    final failure = await repository.register(
      email,
      _password.text,
      captchaToken: _captcha,
    );
    if (!mounted) return;
    _resetCaptcha();
    setState(() {
      _pending = false;
      _formError = failure;
      if (failure == null) _sentTo = email;
    });
  }

  Future<void> _resend() async {
    final repository = ref.read(authRepositoryProvider);
    final email = _sentTo;
    if (repository == null || email == null) return;
    if (_captchaBlocks) {
      setState(() => _formError = AuthFailure.captchaRequired);
      return;
    }
    setState(() {
      _pending = true;
      _formError = null;
      _info = null;
    });
    final failure = await repository.resendConfirmation(
      email,
      captchaToken: _captcha,
    );
    if (!mounted) return;
    _resetCaptcha();
    final t = AuthMessages.of(context);
    setState(() {
      _pending = false;
      _formError = failure;
      _info = failure == null ? t.confirmationResent : null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AuthMessages.of(context);
    final sentTo = _sentTo;
    if (sentTo != null) {
      // Same message whether or not the email is registered.
      return AuthScaffold(
        brand: t.brand,
        title: t.checkEmailTitle,
        subtitle: t.checkEmailBody(sentTo),
        children: [
          TurnstileField(
            resetKey: _captchaReset,
            onToken: (token) => setState(() => _captcha = token),
          ),
          if (_formError != null)
            AuthMessageText(t.error(_formError!), isError: true),
          if (_info != null) AuthMessageText(_info!),
          OutlinedButton(
            key: const Key('register-resend'),
            onPressed: _pending ? null : _resend,
            child: Text(t.resendConfirmation),
          ),
          const SizedBox(height: AppSpacing.s2),
          TextButton(
            key: const Key('register-change-email'),
            onPressed: _pending
                ? null
                : () => setState(() {
                    _sentTo = null;
                    _formError = null;
                    _info = null;
                  }),
            child: Text(t.changeEmail),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text(t.toLogin),
          ),
        ],
      );
    }
    return AuthScaffold(
      brand: t.brand,
      title: t.registerTitle,
      subtitle: t.registerSubtitle,
      children: [
        TextField(
          key: const Key('register-email'),
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(
            labelText: t.email,
            hintText: t.emailPlaceholder,
            errorText: _emailError == null ? null : t.error(_emailError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        TextField(
          key: const Key('register-password'),
          controller: _password,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          decoration: InputDecoration(
            labelText: t.password,
            errorText: _passwordError == null ? null : t.error(_passwordError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        TextField(
          key: const Key('register-confirm'),
          controller: _confirm,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            labelText: t.confirmPassword,
            errorText: _confirmError == null ? null : t.error(_confirmError!),
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
          key: const Key('register-submit'),
          onPressed: _pending ? null : _submit,
          child: Text(t.submitRegister),
        ),
        const SizedBox(height: AppSpacing.s3),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(t.haveAccount),
            TextButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: Text(t.toLogin),
            ),
          ],
        ),
      ],
    );
  }
}
