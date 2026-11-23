import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/application/auth_providers.dart';
import '../../cart/presentation/cart_widgets.dart';
import '../domain/product_report.dart';
import 'report_messages.dart';

/// "Signaler" on a public product (spec 19, section 4). Buyers only (PD-1):
/// guests are sent to the account tab to sign in, and other accounts (which
/// the app only shows the "managed on the web" screen anyway) do not see it.
class ReportProductButton extends ConsumerWidget {
  const ReportProductButton({
    super.key,
    required this.productId,
    required this.name,
  });

  final String productId;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ReportMessages.of(context);
    final signedIn = ref.watch(
      authSessionProvider.select((session) => session.value != null),
    );
    final (loading, buyerId) = ref.watch(buyerSessionProvider);
    // Signed in, but not a Buyer: read-only browsing (AT-1, Q6).
    if (signedIn && !loading && buyerId == null) return const SizedBox.shrink();
    final guest = !signedIn;
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: TextButton.icon(
        key: const Key('report-product'),
        style: TextButton.styleFrom(
          foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        icon: const Icon(Icons.flag_outlined, size: AppIconSize.inline),
        label: Text(t.action),
        onPressed: loading
            ? null
            : guest
            ? () {
                ScaffoldMessenger.maybeOf(
                  context,
                )?.showSnackBar(SnackBar(content: Text(t.signInPrompt)));
                openAccount(context, ref);
              }
            : () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => ReportSheet(productId: productId, name: name),
              ),
      ),
    );
  }
}

/// The report form: a reason, and a description (required with "Autre").
@visibleForTesting
class ReportSheet extends ConsumerStatefulWidget {
  const ReportSheet({super.key, required this.productId, required this.name});

  final String productId;
  final String name;

  @override
  ConsumerState<ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<ReportSheet> {
  final _details = TextEditingController();
  ProductReportReason? _reason;
  ReportFormError? _error;
  ReportOutcome? _outcome;
  bool _sending = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final built = buildProductReport(widget.productId, _reason, _details.text);
    setState(() => _error = built.error);
    final body = built.body;
    if (body == null) return;
    setState(() => _sending = true);
    final repository = ref.read(authRepositoryProvider);
    final token = await repository?.accessToken();
    final ReportOutcome outcome;
    if (repository == null || token == null) {
      outcome = ReportOutcome.signIn;
    } else {
      outcome = interpretReportResult(
        await ref
            .read(apiClientProvider)
            .send<Object?>(
              'POST',
              productReportPath,
              accessToken: token,
              body: body,
              decode: (json) => json,
            ),
      );
    }
    if (!mounted) return;
    setState(() {
      _sending = false;
      _outcome = outcome;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ReportMessages.of(context);
    final theme = Theme.of(context);
    final colors = context.appColors;
    final error = _error;
    final outcome = _outcome;
    final detailsError = switch (error) {
      ReportFormError.detailsRequired ||
      ReportFormError.detailsLength ||
      ReportFormError.detailsInvalid => t.error(error!),
      _ => null,
    };
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.pageGutter,
        right: AppSpacing.pageGutter,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.s6,
      ),
      child: SingleChildScrollView(
        child: Column(
          key: const Key('report-sheet'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(t.title, style: theme.textTheme.titleLarge),
            Text(
              widget.name,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.s3),
            if (outcome == ReportOutcome.sent) ...[
              Semantics(
                liveRegion: true,
                child: Text(
                  t.sent,
                  key: const Key('report-sent'),
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: colors.stateSuccessText,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.s2),
              Text(t.sentBody, style: theme.textTheme.bodyMedium),
              const SizedBox(height: AppSpacing.s3),
              FilledButton(
                key: const Key('report-close'),
                onPressed: () => Navigator.of(context).pop(),
                child: Text(t.close),
              ),
            ] else ...[
              Text(t.intro, style: theme.textTheme.bodyMedium),
              const SizedBox(height: AppSpacing.s3),
              Text(t.reasonLabel, style: theme.textTheme.labelLarge),
              const SizedBox(height: AppSpacing.s2),
              Wrap(
                spacing: AppSpacing.s2,
                runSpacing: AppSpacing.s2,
                children: [
                  for (final reason in ProductReportReason.values)
                    ChoiceChip(
                      key: Key('report-reason-${reason.code}'),
                      label: Text(t.reason(reason)),
                      selected: _reason == reason,
                      onSelected: (_) => setState(() => _reason = reason),
                    ),
                ],
              ),
              if (error == ReportFormError.reasonRequired)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.s2),
                  child: Text(
                    t.error(ReportFormError.reasonRequired),
                    key: const Key('report-reason-error'),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colors.stateErrorText,
                    ),
                  ),
                ),
              const SizedBox(height: AppSpacing.s3),
              TextField(
                key: const Key('report-details'),
                controller: _details,
                minLines: 2,
                maxLines: 5,
                maxLength: reportDetailsMax,
                decoration: InputDecoration(
                  labelText: _reason == ProductReportReason.other
                      ? t.detailsLabelRequired
                      : t.detailsLabel,
                  helperText: t.detailsHint,
                  errorText: detailsError,
                ),
              ),
              if (outcome != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.s2),
                  child: Text(
                    t.outcome(outcome),
                    key: const Key('report-error'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.stateErrorText,
                    ),
                  ),
                ),
              FilledButton(
                key: const Key('report-submit'),
                onPressed: _sending ? null : _submit,
                child: Text(_sending ? t.sending : t.submit),
              ),
              TextButton(
                onPressed: _sending ? null : () => Navigator.of(context).pop(),
                child: Text(t.close),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
