import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/auth_failure.dart';
import '../domain/email.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';
import 'forgot_password_screen.dart';
import 'register_screen.dart';
import 'turnstile_field.dart';

/// Email + password login. On success the [AuthGate] shows the account.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  AuthFailure? _emailError;
  AuthFailure? _passwordError;
  AuthFailure? _formError;
  String? _info;
  String? _unconfirmedEmail;
  String? _captcha;
  int _captchaReset = 0;
  bool _pending = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
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
      _info = null;
      _emailError = email == null ? AuthFailure.invalidEmail : null;
      _passwordError = _password.text.isEmpty
          ? AuthFailure.passwordRequired
          : null;
    });
    if (email == null || _passwordError != null) return;
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
    final failure = await repository.signIn(
      email,
      _password.text,
      captchaToken: _captcha,
    );
    if (!mounted) return;
    _resetCaptcha();
    setState(() {
      _pending = false;
      _formError = failure;
      _unconfirmedEmail = failure == AuthFailure.emailNotConfirmed
          ? email
          : null;
    });
  }

  Future<void> _resend() async {
    final repository = ref.read(authRepositoryProvider);
    final email = _unconfirmedEmail;
    if (repository == null || email == null) return;
    if (_captchaBlocks) {
      setState(() => _formError = AuthFailure.captchaRequired);
      return;
    }
    setState(() => _pending = true);
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
    final notConfigured = ref.watch(authRepositoryProvider) == null;
    return AuthScaffold(
      brand: t.brand,
      title: t.loginTitle,
      subtitle: t.loginSubtitle,
      children: [
        if (notConfigured)
          AuthMessageText(t.error(AuthFailure.notConfigured), isError: true),
        TextField(
          key: const Key('login-email'),
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
          key: const Key('login-password'),
          controller: _password,
          obscureText: true,
          autofillHints: const [AutofillHints.password],
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            labelText: t.password,
            errorText: _passwordError == null ? null : t.error(_passwordError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        TurnstileField(
          resetKey: _captchaReset,
          onToken: (token) => setState(() => _captcha = token),
        ),
        if (_formError != null)
          AuthMessageText(t.error(_formError!), isError: true),
        if (_info != null) AuthMessageText(_info!),
        FilledButton(
          key: const Key('login-submit'),
          onPressed: _pending ? null : _submit,
          child: Text(t.submitLogin),
        ),
        if (_unconfirmedEmail != null) ...[
          const SizedBox(height: AppSpacing.s2),
          OutlinedButton(
            key: const Key('login-resend'),
            onPressed: _pending ? null : _resend,
            child: Text(t.resendConfirmation),
          ),
        ],
        const SizedBox(height: AppSpacing.s3),
        TextButton(
          key: const Key('login-forgot'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const ForgotPasswordScreen(),
            ),
          ),
          child: Text(t.forgotPassword),
        ),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(t.noAccount),
            TextButton(
              key: const Key('login-to-register'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const RegisterScreen()),
              ),
              child: Text(t.toRegister),
            ),
          ],
        ),
      ],
    );
  }
}
