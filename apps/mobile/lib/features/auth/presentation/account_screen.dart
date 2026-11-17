import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../buyer/presentation/buyer_dashboard_screen.dart';
import '../../addresses/presentation/address_screens.dart';
import '../application/auth_providers.dart';
import '../data/auth_repository.dart';
import '../domain/account_setup.dart';
import '../domain/auth_failure.dart';
import '../domain/phone_number.dart';
import '../domain/session_check.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';
import 'managed_on_web_screen.dart';

/// Signed-in area (AT-1, buyer only): API session check, account setup when
/// needed, logout. A Seller or Administrator account is managed on the web;
/// the shell shows it [ManagedOnWebScreen] instead of the buyer screens.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key, required this.session});

  final AuthSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AuthMessages.of(context);
    final check = ref.watch(sessionCheckProvider);
    final email = session.email;

    // A set-up Buyer gets the dashboard; setup, errors, and the session check
    // keep the card below.
    if (check case AsyncData(
      value: SessionActive(:final session),
    ) when session.isBuyer) {
      return BuyerDashboardScreen(email: email);
    }

    final List<Widget> status = switch (check) {
      AsyncData(value: SessionActive(:final session)) => [
        AuthMessageText(webOnlyText(t, session.accountType)),
      ],
      AsyncData(value: SessionNotBootstrapped()) => [const _SetupStep()],
      AsyncData(value: SessionUnavailable()) => [
        AuthMessageText(t.authUnavailable, isError: true),
      ],
      AsyncData(value: SessionSignedOut()) => [
        AuthMessageText(t.sessionInvalid, isError: true),
      ],
      AsyncData(value: SessionCheckError()) || AsyncError() => [
        AuthMessageText(t.error(AuthFailure.generic), isError: true),
      ],
      _ => [AuthMessageText(t.sessionChecking)],
    };
    final canRetry = switch (check) {
      AsyncData(value: SessionUnavailable() || SessionCheckError()) ||
      AsyncError() => true,
      _ => false,
    };

    return AuthScaffold(
      brand: t.brand,
      title: t.accountTitle,
      subtitle: email == null ? null : '${t.signedInAs} $email',
      children: [
        ...status,
        if (canRetry)
          OutlinedButton(
            key: const Key('account-retry'),
            onPressed: () => ref.invalidate(sessionCheckProvider),
            child: Text(t.retry),
          ),
        const SizedBox(height: AppSpacing.s2),
        FilledButton.tonal(
          key: const Key('account-logout'),
          onPressed: () => ref.read(authRepositoryProvider)?.signOut(),
          child: Text(t.logout),
        ),
      ],
    );
  }
}

/// Setup by registration intent (AT-1): a seller intent is completed on the
/// web (the app is buyer only, Q5); otherwise the buyer setup form.
class _SetupStep extends ConsumerWidget {
  const _SetupStep();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AuthMessages.of(context);
    return switch (ref.watch(ownIntentProvider)) {
      AsyncData(value: AccountTypes.seller) => Column(
        key: const Key('setup-seller-intent'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            t.sellerIntentTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppSpacing.s1),
          AuthMessageText(t.sellerIntentBody),
        ],
      ),
      AsyncData() || AsyncError() => const AccountSetupForm(),
      _ => AuthMessageText(t.sessionChecking),
    };
  }
}

/// Account setup after email confirmation (spec 03/04, AT-1): the required
/// contact phone, then a Buyer account. One request in flight; the server is
/// idempotent.
class AccountSetupForm extends ConsumerStatefulWidget {
  const AccountSetupForm({super.key});

  @override
  ConsumerState<AccountSetupForm> createState() => _AccountSetupFormState();
}

class _AccountSetupFormState extends ConsumerState<AccountSetupForm> {
  final _phone = TextEditingController();
  AuthFailure? _phoneError;
  String? _formError;
  bool _pending = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    final phone = normalizePhoneNumber(_phone.text);
    setState(() {
      _formError = null;
      _phoneError = phone == null ? AuthFailure.invalidPhone : null;
    });
    if (phone == null) return;
    setState(() => _pending = true);
    final outcome = await submitAccountSetup(
      ref,
      phone,
      languageCode: Localizations.localeOf(context).languageCode,
    );
    if (!mounted) return;
    final t = AuthMessages.of(context);
    setState(() {
      _pending = false;
      switch (outcome) {
        case SetupDone():
          ref.invalidate(sessionCheckProvider);
          ref.invalidate(customerAccountProvider);
          // Spec 05: offer the delivery location right after account setup (skippable).
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const AddressEditorScreen(onboarding: true),
            ),
          );
        case SetupInvalidPhone():
          _phoneError = AuthFailure.invalidPhone;
        case SetupTypeConflict():
          _formError = t.typeConflict;
        case SetupIntentRequired():
          _formError = t.error(AuthFailure.generic);
        case SetupEmailNotConfirmed():
          _formError = t.error(AuthFailure.emailNotConfirmed);
        case SetupUnavailable():
          _formError = t.authUnavailable;
        case SetupRateLimited():
          _formError = t.error(AuthFailure.rateLimited);
        case SetupSignedOut():
          break;
        case SetupError():
          _formError = t.error(AuthFailure.generic);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AuthMessages.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(t.setupTitle, style: theme.textTheme.titleMedium),
        const SizedBox(height: AppSpacing.s1),
        Text(
          t.setupSubtitle,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        TextField(
          key: const Key('setup-phone'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textDirection: TextDirection.ltr,
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            labelText: t.phone,
            hintText: t.phonePlaceholder,
            helperText: t.setupPhoneHint,
            helperMaxLines: 3,
            errorText: _phoneError == null ? null : t.error(_phoneError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        if (_formError != null) AuthMessageText(_formError!, isError: true),
        FilledButton(
          key: const Key('setup-submit'),
          onPressed: _pending ? null : _submit,
          child: Text(t.submitSetup),
        ),
        const SizedBox(height: AppSpacing.s2),
      ],
    );
  }
}
