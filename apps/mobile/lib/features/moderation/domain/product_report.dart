import '../../../core/network/api_client.dart';

/// Buyer product reports (spec 19, section 4). Buyers only (PD-1); the buyer
/// sees only that the report was sent, never an outcome (PD-4). The API
/// decides who may report, which products, and how often.
const productReportPath = '/customers/me/product-reports';

/// The buyer's reasons (PD-2), the same list as the API.
enum ProductReportReason {
  counterfeit('COUNTERFEIT'),
  prohibitedItem('PROHIBITED_ITEM'),
  notNew('NOT_NEW'),
  notFashion('NOT_FASHION'),
  misleadingInformation('MISLEADING_INFORMATION'),
  inappropriateContent('INAPPROPRIATE_CONTENT'),
  other('OTHER');

  const ProductReportReason(this.code);
  final String code;
}

/// Description limit, counted after trimming (the API's `plainText`).
const reportDetailsMax = 1000;

enum ReportFormError {
  reasonRequired,
  detailsRequired,
  detailsLength,
  detailsInvalid,
}

/// The control characters the API refuses (all but the line feed).
final _forbidden = RegExp(r'[\u0000-\u0009\u000b-\u001f\u007f-\u009f]');

/// The report body, or why it cannot be sent. A reason is required, and a
/// description with `OTHER` (the S2-4 pattern).
({Map<String, Object?>? body, ReportFormError? error}) buildProductReport(
  String productId,
  ProductReportReason? reason,
  String details,
) {
  if (reason == null) {
    return (body: null, error: ReportFormError.reasonRequired);
  }
  final trimmed = details.replaceAll(RegExp(r'\r\n?'), '\n').trim();
  if (reason == ProductReportReason.other && trimmed.isEmpty) {
    return (body: null, error: ReportFormError.detailsRequired);
  }
  if (trimmed.runes.length > reportDetailsMax) {
    return (body: null, error: ReportFormError.detailsLength);
  }
  if (_forbidden.hasMatch(trimmed)) {
    return (body: null, error: ReportFormError.detailsInvalid);
  }
  return (
    body: {
      'productId': productId,
      'reasonCode': reason.code,
      if (trimmed.isNotEmpty) 'details': trimmed,
    },
    error: null,
  );
}

enum ReportOutcome {
  /// `201` (new) and `200` (a repeat) read the same: "Signalement envoyé".
  sent,
  signIn,
  notAllowed,
  notFound,
  invalid,
  rateLimited,
  unavailable,
  error,
}

ReportOutcome interpretReportResult(ApiResult<Object?> result) =>
    switch (result) {
      ApiOk() => ReportOutcome.sent,
      ApiUnauthorized() => ReportOutcome.signIn,
      ApiForbidden() => ReportOutcome.notAllowed,
      ApiAuthUnavailable() || ApiNetworkError() => ReportOutcome.unavailable,
      ApiError(statusCode: 404) => ReportOutcome.notFound,
      ApiError(statusCode: 400) => ReportOutcome.invalid,
      ApiError(statusCode: 429) => ReportOutcome.rateLimited,
      ApiError(statusCode: 503) => ReportOutcome.unavailable,
      ApiError() => ReportOutcome.error,
    };
