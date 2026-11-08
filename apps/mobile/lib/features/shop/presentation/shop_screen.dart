import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/theme/app_theme.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/presentation/auth_scaffold.dart';
import '../application/shop_providers.dart';
import '../domain/shop.dart';
import 'shop_messages.dart';

/// Picks a logo image and returns its bytes (`null` when cancelled).
/// Overridden in tests.
final logoPickerProvider = Provider<Future<Uint8List?> Function()>(
  (ref) => () async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    return file?.readAsBytes();
  },
);

String _formatDate(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

/// Seller shop (spec 06): application, status with the rejection reason,
/// correction and resubmission, approved-shop editing, change requests, and
/// the logo. The API enforces every rule; the screen shows what the status
/// allows.
class ShopScreen extends ConsumerWidget {
  const ShopScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ShopMessages.of(context);
    final outcome = ref.watch(ownerShopProvider);

    final List<Widget> children = switch (outcome) {
      AsyncValue(value: final value?) when value.kind == ShopOutcomeKind.ok => [
        _StatusCard(shop: value.shop!),
        if (value.shop!.status != ShopStatus.suspended) ...[
          _LogoCard(shop: value.shop!),
          // Keyed by status, not updatedAt: logo changes and saves bump
          // updatedAt and must not discard unsaved edits or the saved message.
          _FieldsCard(
            key: ValueKey('fields-${value.shop!.status.name}'),
            shop: value.shop!,
          ),
        ],
        if (value.shop!.status == ShopStatus.approved)
          _ChangeRequestCard(shop: value.shop!)
        else if (value.shop!.changeRequest != null)
          _ChangeRequestStatus(shop: value.shop!),
      ],
      AsyncValue(value: final value?)
          when value.kind == ShopOutcomeKind.noShop =>
        [const _ApplicationCard()],
      AsyncLoading() => [AuthMessageText(t.loading)],
      _ => [
        AuthMessageText(
          outcome.value?.kind == ShopOutcomeKind.unavailable
              ? t.outcome(ShopOutcomeKind.unavailable)
              : t.generic,
          isError: true,
        ),
        OutlinedButton(
          key: const Key('shop-retry'),
          onPressed: () => ref.invalidate(ownerShopProvider),
          child: Text(t.retry),
        ),
      ],
    };

    return Scaffold(
      appBar: AppBar(title: Text(t.title)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.pageGutter),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final child in children)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.s4),
                      child: child,
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

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children, this.subtitle});

  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: textTheme.titleMedium),
            if (subtitle != null) ...[
              const SizedBox(height: AppSpacing.s1),
              Text(
                subtitle!,
                style: textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.s4),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// Text fields of the shop, limited to [fields].
class _ShopFields extends StatelessWidget {
  const _ShopFields({
    required this.fields,
    required this.controllers,
    required this.errors,
  });

  final List<ShopField> fields;
  final Map<ShopField, TextEditingController> controllers;
  final Map<ShopField, ShopFieldError> errors;

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final field in fields)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s3),
            child: TextField(
              key: Key('shop-field-${field.name}'),
              controller: controllers[field],
              maxLines: field == ShopField.description ? 5 : 1,
              minLines: field == ShopField.description ? 3 : 1,
              keyboardType:
                  field == ShopField.contactPhone ||
                      field == ShopField.whatsappPhone
                  ? TextInputType.phone
                  : field == ShopField.description
                  ? TextInputType.multiline
                  : TextInputType.text,
              textDirection:
                  field == ShopField.contactPhone ||
                      field == ShopField.whatsappPhone
                  ? TextDirection.ltr
                  : null,
              decoration: InputDecoration(
                labelText: t.field(field),
                errorText: errors[field] == null
                    ? null
                    : t.error(errors[field]!),
              ),
            ),
          ),
        if (fields.contains(ShopField.contactPhone))
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s3),
            child: Text(
              t.phoneHint,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

Map<ShopField, TextEditingController> _controllers(ShopFormValues values) => {
  for (final field in ShopField.values)
    field: TextEditingController(text: values[field] ?? ''),
};

ShopFormValues _read(Map<ShopField, TextEditingController> controllers) => {
  for (final entry in controllers.entries) entry.key: entry.value.text,
};

class _ApplicationCard extends ConsumerStatefulWidget {
  const _ApplicationCard();

  @override
  ConsumerState<_ApplicationCard> createState() => _ApplicationCardState();
}

class _ApplicationCardState extends ConsumerState<_ApplicationCard> {
  final _fields = _controllers(const {});
  Map<ShopField, ShopFieldError> _errors = const {};
  String? _message;
  bool _pending = false;

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    final result = buildShopCreate(_read(_fields));
    setState(() {
      _errors = result.errors;
      _message = null;
    });
    if (!result.isValid) return;
    setState(() => _pending = true);
    final outcome = await sendShopRequest(
      ref,
      'POST',
      '/sellers/me/shop',
      result.body,
    );
    if (!mounted) return;
    setState(() {
      _pending = false;
      if (outcome.kind != ShopOutcomeKind.ok) {
        _message = ShopMessages.of(context).outcome(outcome.kind);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    return _Section(
      title: t.applyTitle,
      subtitle: t.applySubtitle,
      children: [
        _ShopFields(
          fields: ShopField.values,
          controllers: _fields,
          errors: _errors,
        ),
        if (_message != null) AuthMessageText(_message!, isError: true),
        FilledButton(
          key: const Key('shop-apply'),
          onPressed: _pending ? null : _submit,
          child: Text(t.submitApplication),
        ),
      ],
    );
  }
}

class _StatusCard extends ConsumerStatefulWidget {
  const _StatusCard({required this.shop});
  final OwnerShop shop;

  @override
  ConsumerState<_StatusCard> createState() => _StatusCardState();
}

class _StatusCardState extends ConsumerState<_StatusCard> {
  String? _message;
  bool _isError = false;
  bool _pending = false;

  Future<void> _resubmit() async {
    if (_pending) return;
    setState(() => _pending = true);
    final outcome = await sendShopRequest(
      ref,
      'POST',
      '/sellers/me/shop/resubmit',
    );
    if (!mounted) return;
    final t = ShopMessages.of(context);
    setState(() {
      _pending = false;
      _isError = outcome.kind != ShopOutcomeKind.ok;
      _message = _isError ? t.outcome(outcome.kind) : t.resubmitted;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    final shop = widget.shop;
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return _Section(
      title: t.title,
      children: [
        Row(
          children: [
            if (shop.logoUrl != null)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: AppSpacing.s3),
                child: ClipRRect(
                  borderRadius: AppRadius.card,
                  child: Image.network(
                    shop.logoUrl!,
                    width: 56,
                    height: 56,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox(width: 56),
                  ),
                ),
              ),
            Expanded(child: Text(shop.shopName, style: textTheme.titleMedium)),
            Chip(
              key: const Key('shop-status'),
              label: Text(t.status(shop.status)),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.s3),
        Text(t.statusHelp(shop.status), style: textTheme.bodyMedium),
        if (shop.latestDecision != null && shop.latestDecisionAt != null) ...[
          const SizedBox(height: AppSpacing.s2),
          Text(
            '${t.latestDecision} : ${t.decision(shop.latestDecision!)} · ${_formatDate(shop.latestDecisionAt!)}',
            key: const Key('shop-latest-decision'),
            style: textTheme.bodySmall,
          ),
        ],
        if (shop.status == ShopStatus.rejected &&
            shop.rejectionReason != null) ...[
          const SizedBox(height: AppSpacing.s3),
          Container(
            key: const Key('shop-rejection'),
            padding: const EdgeInsets.all(AppSpacing.s4),
            decoration: BoxDecoration(
              color: colors.errorContainer,
              borderRadius: AppRadius.card,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.rejectionTitle,
                  style: textTheme.titleSmall?.copyWith(
                    color: colors.onErrorContainer,
                  ),
                ),
                const SizedBox(height: AppSpacing.s1),
                Text(
                  shop.rejectionReason!,
                  style: textTheme.bodyMedium?.copyWith(
                    color: colors.onErrorContainer,
                  ),
                ),
                if (shop.rejectedAt != null)
                  Text(
                    '${t.rejectedOn} ${_formatDate(shop.rejectedAt!)}',
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onErrorContainer,
                    ),
                  ),
              ],
            ),
          ),
        ],
        if (shop.status == ShopStatus.suspended) ...[
          const SizedBox(height: AppSpacing.s3),
          AuthMessageText(t.suspendedNotice),
        ],
        if (_message != null) ...[
          const SizedBox(height: AppSpacing.s3),
          AuthMessageText(_message!, isError: _isError),
        ],
        if (shop.status == ShopStatus.rejected) ...[
          const SizedBox(height: AppSpacing.s3),
          FilledButton(
            key: const Key('shop-resubmit'),
            onPressed: _pending ? null : _resubmit,
            child: Text(t.resubmit),
          ),
        ],
      ],
    );
  }
}

class _FieldsCard extends ConsumerStatefulWidget {
  const _FieldsCard({super.key, required this.shop});
  final OwnerShop shop;

  @override
  ConsumerState<_FieldsCard> createState() => _FieldsCardState();
}

class _FieldsCardState extends ConsumerState<_FieldsCard> {
  late final _fields = _controllers(shopFormValues(widget.shop));
  Map<ShopField, ShopFieldError> _errors = const {};
  String? _message;
  bool _isError = false;
  bool _pending = false;

  /// A refreshed shop updates untouched fields; unsaved edits stay.
  @override
  void didUpdateWidget(_FieldsCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    _merge(shopFormValues(oldWidget.shop), shopFormValues(widget.shop));
  }

  void _merge(ShopFormValues baseline, ShopFormValues next) {
    final merged = mergeShopFormValues(_read(_fields), baseline, next);
    for (final entry in merged.entries) {
      final controller = _fields[entry.key]!;
      if (controller.text != entry.value) controller.text = entry.value;
    }
  }

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_pending) return;
    final t = ShopMessages.of(context);
    final result = buildShopUpdate(_read(_fields), widget.shop);
    setState(() {
      _errors = result.errors;
      _message = null;
    });
    if (!result.isValid) return;
    if (result.body.isEmpty) {
      setState(() {
        _isError = false;
        _message = t.noChanges;
      });
      return;
    }
    setState(() => _pending = true);
    final sent = _read(_fields);
    final outcome = await sendShopRequest(
      ref,
      'PATCH',
      '/sellers/me/shop',
      result.body,
    );
    if (!mounted) return;
    // Saved fields show the server's normalized values.
    if (outcome.kind == ShopOutcomeKind.ok) {
      _merge(sent, shopFormValues(outcome.shop!));
    }
    setState(() {
      _pending = false;
      _isError = outcome.kind != ShopOutcomeKind.ok;
      _message = _isError ? t.outcome(outcome.kind) : t.saved;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    return _Section(
      title: t.editTitle,
      subtitle: widget.shop.status == ShopStatus.approved
          ? t.editApprovedHint
          : null,
      children: [
        _ShopFields(
          fields: directlyEditableFields(widget.shop.status),
          controllers: _fields,
          errors: _errors,
        ),
        if (_message != null) AuthMessageText(_message!, isError: _isError),
        FilledButton(
          key: const Key('shop-save'),
          onPressed: _pending ? null : _save,
          child: Text(t.save),
        ),
      ],
    );
  }
}

class _ChangeRequestStatus extends StatelessWidget {
  const _ChangeRequestStatus({required this.shop});
  final OwnerShop shop;

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    final request = shop.changeRequest;
    if (request == null) return const SizedBox.shrink();
    final textTheme = Theme.of(context).textTheme;
    return Container(
      key: const Key('shop-change-request'),
      padding: const EdgeInsets.all(AppSpacing.s4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: AppRadius.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t.changeRequest(request.status), style: textTheme.labelLarge),
          if (request.proposedShopName != null)
            Text(
              '${t.field(ShopField.shopName)} — ${t.proposed} : ${request.proposedShopName}',
              style: textTheme.bodySmall,
            ),
          if (request.proposedCity != null)
            Text(
              '${t.field(ShopField.city)} — ${t.proposed} : ${request.proposedCity}',
              style: textTheme.bodySmall,
            ),
          Text(
            _formatDate(request.decidedAt ?? request.submittedAt),
            style: textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _ChangeRequestCard extends ConsumerStatefulWidget {
  const _ChangeRequestCard({required this.shop});
  final OwnerShop shop;

  @override
  ConsumerState<_ChangeRequestCard> createState() => _ChangeRequestCardState();
}

class _ChangeRequestCardState extends ConsumerState<_ChangeRequestCard> {
  late final _fields = _controllers(shopFormValues(widget.shop));
  Map<ShopField, ShopFieldError> _errors = const {};
  String? _message;
  bool _isError = false;
  bool _pending = false;

  /// The form restarts from the current values when a request opens or is
  /// decided; any other reload keeps unsent edits. The form is hidden while a
  /// request is open, so this never discards text the owner can still see. A
  /// message about the submission stays until the request is decided.
  @override
  void didUpdateWidget(_ChangeRequestCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final before = oldWidget.shop.changeRequest;
    final after = widget.shop.changeRequest;
    if (before?.id == after?.id && before?.status == after?.status) return;
    for (final entry in shopFormValues(widget.shop).entries) {
      _fields[entry.key]!.text = entry.value;
    }
    _errors = const {};
    if (after?.status != ChangeRequestStatus.pending) _message = null;
  }

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    final t = ShopMessages.of(context);
    final result = buildChangeRequest(
      _fields[ShopField.shopName]!.text,
      _fields[ShopField.city]!.text,
      widget.shop,
    );
    setState(() {
      _errors = result.errors;
      _message = null;
    });
    if (!result.isValid) return;
    if (result.body.isEmpty) {
      setState(() {
        _isError = false;
        _message = t.noChanges;
      });
      return;
    }
    setState(() => _pending = true);
    final outcome = await sendShopRequest(
      ref,
      'POST',
      '/sellers/me/shop/change-requests',
      result.body,
    );
    if (!mounted) return;
    setState(() {
      _pending = false;
      _isError = outcome.kind != ShopOutcomeKind.ok;
      _message = _isError ? t.outcome(outcome.kind) : t.changeRequestSent;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    final shop = widget.shop;
    final open = shop.changeRequest?.status == ChangeRequestStatus.pending;
    return _Section(
      title: t.changeRequestTitle,
      subtitle: t.changeRequestHint,
      children: [
        Text(
          '${t.current} : ${shop.shopName} · ${shop.city}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppSpacing.s3),
        if (shop.changeRequest != null) ...[
          _ChangeRequestStatus(shop: shop),
          const SizedBox(height: AppSpacing.s3),
        ],
        if (!open) ...[
          _ShopFields(
            fields: const [ShopField.shopName, ShopField.city],
            controllers: _fields,
            errors: _errors,
          ),
          OutlinedButton(
            key: const Key('shop-change-request-submit'),
            onPressed: _pending ? null : _submit,
            child: Text(t.submitChangeRequest),
          ),
        ],
        if (_message != null) AuthMessageText(_message!, isError: _isError),
      ],
    );
  }
}

class _LogoCard extends ConsumerStatefulWidget {
  const _LogoCard({required this.shop});
  final OwnerShop shop;

  @override
  ConsumerState<_LogoCard> createState() => _LogoCardState();
}

class _LogoCardState extends ConsumerState<_LogoCard> {
  String? _message;
  bool _isError = false;
  bool _pending = false;

  Future<void> _pick() async {
    if (_pending) return;
    final bytes = await ref.read(logoPickerProvider)();
    if (bytes == null || !mounted) return;
    final t = ShopMessages.of(context);
    setState(() {
      _pending = true;
      _isError = false;
      _message = t.uploadingLogo;
    });
    final repository = ref.read(authRepositoryProvider);
    final outcome = await uploadShopLogo(
      api: ref.read(apiClientProvider),
      accessToken: () async => repository?.accessToken(),
      bytes: bytes,
    );
    if (!mounted) return;
    if (outcome.kind == LogoUploadKind.signedOut) await repository?.signOut();
    if (outcome.kind == LogoUploadKind.ok) ref.invalidate(ownerShopProvider);
    setState(() {
      _pending = false;
      _isError = outcome.kind != LogoUploadKind.ok;
      _message = switch (outcome.kind) {
        LogoUploadKind.ok => t.logoSaved,
        LogoUploadKind.rejected => t.logoError(outcome.code ?? ''),
        LogoUploadKind.error || LogoUploadKind.signedOut => t.generic,
        final kind => t.logoError(kind.name),
      };
    });
  }

  Future<void> _remove() async {
    if (_pending) return;
    setState(() => _pending = true);
    final outcome = await sendShopRequest(ref, 'PATCH', '/sellers/me/shop', {
      'logoUrl': null,
    });
    if (!mounted) return;
    final t = ShopMessages.of(context);
    setState(() {
      _pending = false;
      _isError = outcome.kind != ShopOutcomeKind.ok;
      _message = _isError ? t.outcome(outcome.kind) : t.logoRemoved;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ShopMessages.of(context);
    final logoUrl = widget.shop.logoUrl;
    return _Section(
      title: t.logoTitle,
      subtitle: t.logoHint,
      children: [
        if (logoUrl != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s3),
            child: ClipRRect(
              borderRadius: AppRadius.card,
              child: Image.network(
                logoUrl,
                height: 96,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => const SizedBox(height: 96),
              ),
            ),
          ),
        if (_message != null) AuthMessageText(_message!, isError: _isError),
        OutlinedButton(
          key: const Key('shop-logo-pick'),
          onPressed: _pending ? null : _pick,
          child: Text(t.chooseLogo),
        ),
        if (logoUrl != null)
          TextButton(
            key: const Key('shop-logo-remove'),
            onPressed: _pending ? null : _remove,
            child: Text(t.removeLogo),
          ),
      ],
    );
  }
}
