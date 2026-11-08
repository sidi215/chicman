import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/widgets/theme_mode_selector.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/domain/account_setup.dart';
import '../../auth/presentation/auth_scaffold.dart';
import '../application/profile_providers.dart';
import '../domain/profile_update.dart';
import 'profile_messages.dart';

/// Customer profile settings (spec 04): `fullName`, `preferredLocale`, and
/// the unverified contact `phone` through `PATCH /customers/me`, plus the
/// device-local theme selector (never sent to the API).
class ProfileSettingsScreen extends ConsumerWidget {
  const ProfileSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ProfileMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    final account = ref.watch(customerAccountProvider);

    final Widget profile = switch (account) {
      // Keep the form mounted while the account reloads after a save.
      AsyncValue(value: final value?) => ProfileForm(
        key: ValueKey(value.userId),
        account: value,
      ),
      AsyncLoading() => AuthMessageText(t.loading),
      _ => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthMessageText(t.generic, isError: true),
          OutlinedButton(
            key: const Key('profile-retry'),
            onPressed: () => ref.invalidate(customerAccountProvider),
            child: Text(t.retry),
          ),
        ],
      ),
    };

    return Scaffold(
      appBar: AppBar(title: Text(t.title)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.pageGutter),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 448),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.s6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(t.personalSection, style: textTheme.titleMedium),
                          const SizedBox(height: AppSpacing.s1),
                          Text(
                            t.subtitle,
                            style: textTheme.bodyMedium?.copyWith(
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.s4),
                          profile,
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.s6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            t.appearanceSection,
                            style: textTheme.titleMedium,
                          ),
                          const SizedBox(height: AppSpacing.s3),
                          const Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: ThemeModeSelector(
                              key: Key('profile-theme-selector'),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.s2),
                          AuthMessageText(t.appearanceHint),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The editable allowlist. One request in flight; only changed fields are sent.
class ProfileForm extends ConsumerStatefulWidget {
  const ProfileForm({super.key, required this.account});

  final CustomerAccount account;

  @override
  ConsumerState<ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<ProfileForm> {
  late CustomerAccount _stored = widget.account;
  late final _fullName = TextEditingController(
    text: widget.account.fullName ?? '',
  );
  late final _phone = TextEditingController(text: widget.account.phone);
  late String _locale = widget.account.preferredLocale;
  ProfileFieldError? _fullNameError;
  ProfileFieldError? _phoneError;
  // The text is chosen when shown: saving a language changes the interface's.
  (String Function(ProfileMessages), bool)? _notice;
  bool _pending = false;

  @override
  void dispose() {
    _fullName.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    final result = buildProfileUpdate(
      ProfileFormValues(
        fullName: _fullName.text,
        preferredLocale: _locale,
        phone: _phone.text,
      ),
      _stored,
    );
    setState(() {
      _notice = null;
      _fullNameError = result.fullNameError;
      _phoneError = result.phoneError;
      if (result.isValid && !result.hasChanges) {
        _notice = ((t) => t.noChanges, false);
      }
    });
    if (!result.isValid || !result.hasChanges) return;
    setState(() => _pending = true);
    final outcome = await submitProfileUpdate(ref, result.changes);
    if (!mounted) return;
    setState(() {
      _pending = false;
      switch (outcome) {
        case ProfileSaved(:final account):
          _stored = account;
          _fullName.text = account.fullName ?? '';
          _phone.text = account.phone;
          _locale = account.preferredLocale;
          _notice = ((t) => t.saved, false);
        case ProfileInvalidPhone():
          _phoneError = ProfileFieldError.invalidPhone;
        case ProfileInvalid():
          _notice = ((t) => t.invalid, true);
        case ProfileUnavailable():
          _notice = ((t) => t.unavailable, true);
        case ProfileRateLimited():
          _notice = ((t) => t.rateLimited, true);
        case ProfileNotBootstrapped() || ProfileUpdateError():
          _notice = ((t) => t.generic, true);
        case ProfileSignedOut():
          break;
      }
    });
    if (outcome is ProfileSignedOut || outcome is ProfileNotBootstrapped) {
      Navigator.of(context).popUntil((route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = ProfileMessages.of(context);
    final notice = _notice;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('profile-full-name'),
          controller: _fullName,
          autofillHints: const [AutofillHints.name],
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(
            labelText: t.fullName,
            hintText: t.fullNamePlaceholder,
            errorText: _fullNameError == null ? null : t.error(_fullNameError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        Text(t.preferredLocale, style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: AppSpacing.s2),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: SegmentedButton<String>(
            key: const Key('profile-locale'),
            showSelectedIcon: false,
            segments: [
              for (final code in profileLocales)
                ButtonSegment(value: code, label: Text(t.locale(code))),
            ],
            selected: {_locale},
            onSelectionChanged: (selection) =>
                setState(() => _locale = selection.single),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        TextField(
          key: const Key('profile-phone'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textDirection: TextDirection.ltr,
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            labelText: t.phone,
            hintText: t.phonePlaceholder,
            helperText: t.phoneHint,
            helperMaxLines: 3,
            errorText: _phoneError == null ? null : t.error(_phoneError!),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        if (notice != null) AuthMessageText(notice.$1(t), isError: notice.$2),
        FilledButton(
          key: const Key('profile-save'),
          onPressed: _pending ? null : _submit,
          child: Text(t.save),
        ),
      ],
    );
  }
}
