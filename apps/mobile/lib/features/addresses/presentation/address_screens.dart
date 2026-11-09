import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../auth/presentation/auth_scaffold.dart';
import '../application/address_providers.dart';
import '../domain/address.dart';
import 'address_messages.dart';
import 'location_picker.dart';

Widget _page(String title, List<Widget> children) => Scaffold(
  appBar: AppBar(title: Text(title)),
  body: SafeArea(
    child: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.pageGutter),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          ),
        ),
      ),
    ),
  ),
);

/// Saved delivery addresses: default choice, edit, delete (spec 05). With
/// [selectForCheckout] it is also checkout's address choice (spec 10): the same
/// list, where "Livrer à cette adresse" returns the address ID to checkout.
class AddressListScreen extends ConsumerStatefulWidget {
  const AddressListScreen({super.key, this.selectForCheckout = false});

  final bool selectForCheckout;

  @override
  ConsumerState<AddressListScreen> createState() => _AddressListScreenState();
}

class _AddressListScreenState extends ConsumerState<AddressListScreen> {
  String? _confirmingDelete;
  String? _message;
  bool _isError = false;
  bool _pending = false;

  Future<void> _act(String method, String path, String success) async {
    if (_pending) return;
    setState(() => _pending = true);
    final outcome = await sendAddressRequest(ref, method, path);
    if (!mounted) return;
    final t = AddressMessages.of(context);
    setState(() {
      _pending = false;
      _confirmingDelete = null;
      _isError = outcome.kind != AddressOutcomeKind.ok;
      _message = _isError ? t.outcome(outcome.kind) : success;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AddressMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    final list = ref.watch(addressListProvider);
    final addresses = list.value?.data ?? const <CustomerAddress>[];
    final loaded = list.value?.kind == AddressOutcomeKind.ok;

    final selecting = widget.selectForCheckout;
    return _page(selecting ? t.selectTitle : t.listTitle, [
      Text(
        selecting ? t.selectSubtitle : t.listSubtitle,
        style: textTheme.bodyMedium,
      ),
      const SizedBox(height: AppSpacing.s4),
      if (list.isLoading && list.value == null) AuthMessageText(t.loading),
      if (list.value != null && !loaded) ...[
        AuthMessageText(t.outcome(list.value!.kind), isError: true),
        OutlinedButton(
          onPressed: () => ref.invalidate(addressListProvider),
          child: Text(t.retry),
        ),
      ],
      if (loaded && addresses.isEmpty) AuthMessageText(t.empty),
      if (_message != null) AuthMessageText(_message!, isError: _isError),
      for (final address in addresses)
        Card(
          key: Key('address-${address.id}'),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        address.label ?? '${address.district}, ${address.city}',
                        style: textTheme.titleSmall,
                      ),
                    ),
                    if (address.isDefault) Chip(label: Text(t.defaultBadge)),
                  ],
                ),
                Text('${address.district}, ${address.city}'),
                Text(address.landmark, style: textTheme.bodySmall),
                if (address.deliveryPhone != null)
                  Text(
                    address.deliveryPhone!,
                    textDirection: TextDirection.ltr,
                    style: textTheme.bodySmall,
                  ),
                const SizedBox(height: AppSpacing.s2),
                if (_confirmingDelete == address.id)
                  Wrap(
                    spacing: AppSpacing.s2,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(t.confirmDelete),
                      FilledButton(
                        key: Key('address-delete-confirm-${address.id}'),
                        onPressed: _pending
                            ? null
                            : () => _act(
                                'DELETE',
                                '/customers/me/addresses/${address.id}',
                                t.deleted,
                              ),
                        child: Text(t.delete),
                      ),
                      TextButton(
                        onPressed: () =>
                            setState(() => _confirmingDelete = null),
                        child: Text(t.cancel),
                      ),
                    ],
                  )
                else
                  Wrap(
                    spacing: AppSpacing.s2,
                    children: [
                      if (selecting)
                        FilledButton(
                          key: Key('address-select-${address.id}'),
                          onPressed: () =>
                              Navigator.of(context).pop(address.id),
                          child: Text(t.deliverHere),
                        ),
                      if (!address.isDefault)
                        OutlinedButton(
                          key: Key('address-default-${address.id}'),
                          onPressed: _pending
                              ? null
                              : () => _act(
                                  'POST',
                                  '/customers/me/addresses/${address.id}/default',
                                  t.defaultChanged,
                                ),
                          child: Text(t.makeDefault),
                        ),
                      OutlinedButton(
                        key: Key('address-edit-${address.id}'),
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                AddressEditorScreen(address: address),
                          ),
                        ),
                        child: Text(t.edit),
                      ),
                      TextButton(
                        key: Key('address-delete-${address.id}'),
                        onPressed: () =>
                            setState(() => _confirmingDelete = address.id),
                        child: Text(t.delete),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      const SizedBox(height: AppSpacing.s4),
      if (loaded && addresses.length >= maxAddressesPerCustomer)
        AuthMessageText(t.limitReached)
      else if (loaded)
        FilledButton(
          key: const Key('address-add'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const AddressEditorScreen(),
            ),
          ),
          child: Text(t.add),
        ),
    ]);
  }
}

/// Create (no [address]) or edit an address: map and details, then a
/// confirmation before saving (`locationConfirmed: true`). [onboarding]
/// adds "Plus tard".
class AddressEditorScreen extends ConsumerStatefulWidget {
  const AddressEditorScreen({super.key, this.address, this.onboarding = false});

  final CustomerAddress? address;
  final bool onboarding;

  @override
  ConsumerState<AddressEditorScreen> createState() =>
      _AddressEditorScreenState();
}

class _AddressEditorScreenState extends ConsumerState<AddressEditorScreen> {
  late final Map<AddressField, TextEditingController> _fields = {
    for (final field in AddressField.values)
      field: TextEditingController(
        text: widget.address == null
            ? ''
            : addressFormValues(widget.address!)[field],
      ),
  };
  late PinLocation? _pin = widget.address?.pin;
  Map<AddressField, AddressFieldError> _errors = const {};
  LocationError? _locationError;
  Map<String, Object?>? _body;
  String? _message;
  bool _pending = false;

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  AddressFormValues get _values => {
    for (final entry in _fields.entries) entry.key: entry.value.text,
  };

  void _review() {
    final t = AddressMessages.of(context);
    final current = widget.address;
    final result = current == null
        ? buildAddressCreate(_values, _pin)
        : buildAddressUpdate(_values, _pin ?? current.pin, current);
    setState(() {
      _errors = result.errors;
      _locationError = result.locationError;
      _message = null;
      if (!result.isValid) return;
      if (result.body.isEmpty) {
        _message = t.noChanges;
        return;
      }
      _body = result.body;
    });
  }

  Future<void> _save() async {
    final body = _body;
    if (_pending || body == null) return;
    setState(() => _pending = true);
    final current = widget.address;
    final outcome = current == null
        ? await sendAddressRequest(ref, 'POST', '/customers/me/addresses', body)
        : await sendAddressRequest(
            ref,
            'PATCH',
            '/customers/me/addresses/${current.id}',
            body,
          );
    if (!mounted) return;
    if (outcome.kind == AddressOutcomeKind.ok) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _pending = false;
      _body = null;
      _message = AddressMessages.of(context).outcome(outcome.kind);
    });
  }

  Future<void> _later() async {
    await ref.read(addressPromptDismissedProvider.notifier).dismiss();
    if (mounted) Navigator.of(context).pop(false);
  }

  @override
  Widget build(BuildContext context) {
    final t = AddressMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    final confirming = _body != null;
    final title = widget.address != null
        ? t.editTitle
        : widget.onboarding
        ? t.onboardingTitle
        : t.newTitle;

    return _page(confirming ? t.confirmTitle : title, [
      if (widget.onboarding && !confirming)
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.s3),
          child: Text(t.onboardingSubtitle, style: textTheme.bodyMedium),
        ),
      if (confirming)
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.s3),
          child: Text(t.confirmHint, style: textTheme.bodyMedium),
        ),
      LocationPicker(
        value: _pin,
        interactive: !confirming,
        onChanged: (pin) => setState(() => _pin = pin),
      ),
      if (_locationError != null)
        AuthMessageText(t.locationError(_locationError!), isError: true),
      const SizedBox(height: AppSpacing.s3),
      if (!confirming) ...[
        for (final field in AddressField.values)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s3),
            child: TextField(
              key: Key('address-field-${field.name}'),
              controller: _fields[field],
              keyboardType: field == AddressField.deliveryPhone
                  ? TextInputType.phone
                  : TextInputType.text,
              textDirection: field == AddressField.deliveryPhone
                  ? TextDirection.ltr
                  : null,
              decoration: InputDecoration(
                labelText: t.field(field),
                hintText: t.placeholder(field),
                errorText: _errors[field] == null
                    ? null
                    : t.error(_errors[field]!),
              ),
            ),
          ),
        Text(t.phoneHint, style: textTheme.bodySmall),
        const SizedBox(height: AppSpacing.s3),
        if (_message != null) AuthMessageText(_message!, isError: true),
        FilledButton(
          key: const Key('address-review'),
          onPressed: _review,
          child: Text(t.review),
        ),
        if (widget.onboarding)
          TextButton(
            key: const Key('address-later'),
            onPressed: _later,
            child: Text(t.later),
          ),
      ] else ...[
        for (final field in AddressField.values)
          if (_fields[field]!.text.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s1),
              child: Text(
                '${t.field(field)} : ${_fields[field]!.text.trim()}',
                style: textTheme.bodyMedium,
              ),
            ),
        const SizedBox(height: AppSpacing.s3),
        FilledButton(
          key: const Key('address-confirm-save'),
          onPressed: _pending ? null : _save,
          child: Text(t.confirmSave),
        ),
        OutlinedButton(
          key: const Key('address-back'),
          onPressed: _pending ? null : () => setState(() => _body = null),
          child: Text(t.back),
        ),
      ],
    ]);
  }
}
