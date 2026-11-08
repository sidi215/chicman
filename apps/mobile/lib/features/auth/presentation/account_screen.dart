import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../profile/presentation/profile_settings_screen.dart';
import '../../addresses/application/address_providers.dart';
import '../../addresses/domain/address.dart';
import '../../addresses/presentation/address_messages.dart';
import '../../addresses/presentation/address_screens.dart';
import '../../shop/presentation/shop_screen.dart';
import '../application/auth_providers.dart';
import '../data/auth_repository.dart';
import '../domain/account_setup.dart';
import '../domain/auth_failure.dart';
import '../domain/phone_number.dart';
import '../domain/session_check.dart';
import 'auth_messages.dart';
import 'auth_scaffold.dart';

/// Signed-in area: API session check, account setup when needed, logout.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key, required this.session});

  final AuthSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AuthMessages.of(context);
    final check = ref.watch(sessionCheckProvider);
    final email = session.email;

    final List<Widget> status = switch (check) {
      AsyncData(value: SessionActive(:final session)) => [
        AuthMessageText(
          '${t.sessionActive} ${t.roles} : ${session.roles.join(', ')}',
        ),
        const _ContactPhone(),
        const _DeliveryAddresses(),
      ],
      AsyncData(value: SessionNotBootstrapped()) => [const AccountSetupForm()],
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

/// The unverified contact phone of the bootstrapped account.
class _ContactPhone extends ConsumerWidget {
  const _ContactPhone();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AuthMessages.of(context);
    final account = ref.watch(customerAccountProvider).value;
    if (account == null) return const SizedBox.shrink();
    final fullName = account.fullName;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (fullName != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s2),
            child: Text(
              fullName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
        AuthMessageText('${t.contactPhone} : ${account.phone}'),
        OutlinedButton(
          key: const Key('account-profile-settings'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const ProfileSettingsScreen(),
            ),
          ),
          child: Text(t.profileSettings),
        ),
        OutlinedButton(
          key: const Key('account-shop'),
          onPressed: () => Navigator.of(
            context,
          ).push(MaterialPageRoute<void>(builder: (_) => const ShopScreen())),
          child: Text(t.myShop),
        ),
      ],
    );
  }
}

/// Account setup after email confirmation (spec 03/04): the required contact
/// phone, then bootstrap. One request in flight; the server is idempotent.
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

/// Delivery addresses (spec 05): the list, and a prompt while the customer
/// has none (until "Plus tard" on this device).
class _DeliveryAddresses extends ConsumerWidget {
  const _DeliveryAddresses();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AddressMessages.of(context);
    final list = ref.watch(addressListProvider).value;
    final dismissed = ref.watch(addressPromptDismissedProvider);
    final none =
        list?.kind == AddressOutcomeKind.ok && (list?.data?.isEmpty ?? false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton(
          key: const Key('account-addresses'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const AddressListScreen()),
          ),
          child: Text(t.myAddresses),
        ),
        if (none && !dismissed)
          Card(
            key: const Key('account-address-prompt'),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    t.promptTitle,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.s1),
                  Text(
                    t.promptBody,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.s3),
                  FilledButton(
                    key: const Key('account-address-prompt-add'),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const AddressEditorScreen(),
                      ),
                    ),
                    child: Text(t.add),
                  ),
                  TextButton(
                    key: const Key('account-address-prompt-later'),
                    onPressed: () => ref
                        .read(addressPromptDismissedProvider.notifier)
                        .dismiss(),
                    child: Text(t.later),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
