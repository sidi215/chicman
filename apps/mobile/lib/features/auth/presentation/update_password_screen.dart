import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_providers.dart';
import '../domain/auth_failure.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';

/// "Set a new password", shown after a verified recovery link.
class UpdatePasswordScreen extends ConsumerStatefulWidget {
  const UpdatePasswordScreen({super.key});

  @override
  ConsumerState<UpdatePasswordScreen> createState() =>
      _UpdatePasswordScreenState();
}

class _UpdatePasswordScreenState extends ConsumerState<UpdatePasswordScreen> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  AuthFailure? _passwordError;
  AuthFailure? _confirmError;
  AuthFailure? _formError;
  bool _done = false;
  bool _pending = false;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _formError = null;
      _passwordError = _password.text.isEmpty
          ? AuthFailure.passwordRequired
          : null;
      _confirmError = _passwordError == null && _password.text != _confirm.text
          ? AuthFailure.passwordMismatch
          : null;
    });
    if (_passwordError != null || _confirmError != null) return;
    final repository = ref.read(authRepositoryProvider);
    if (repository == null) {
      setState(() => _formError = AuthFailure.notConfigured);
      return;
    }
    setState(() => _pending = true);
    final failure = await repository.updatePassword(_password.text);
    if (!mounted) return;
    setState(() {
      _pending = false;
      _formError = failure;
      _done = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AuthMessages.of(context);
    if (_done) {
      return AuthScaffold(
        brand: t.brand,
        title: t.newPasswordTitle,
        children: [
          AuthMessageText(t.passwordUpdated),
          FilledButton(
            key: const Key('new-password-continue'),
            onPressed: () =>
                ref.read(passwordRecoveryProvider.notifier).finish(),
            child: Text(t.accountTitle),
          ),
        ],
      );
    }
    return AuthScaffold(
      brand: t.brand,
      title: t.newPasswordTitle,
      subtitle: t.newPasswordSubtitle,
      children: [
        TextField(
          key: const Key('new-password'),
          controller: _password,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          decoration: InputDecoration(
            labelText: t.newPassword,
            errorText: _passwordError == null ? null : t.error(_passwordError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        TextField(
          key: const Key('new-password-confirm'),
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
        if (_formError != null)
          AuthMessageText(t.error(_formError!), isError: true),
        FilledButton(
          key: const Key('new-password-submit'),
          onPressed: _pending ? null : _submit,
          child: Text(t.submitNewPassword),
        ),
      ],
    );
  }
}
