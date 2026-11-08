import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:maplibre_gl/maplibre_gl.dart' as ml;

import '../../../core/theme/app_theme.dart';
import '../../auth/presentation/auth_scaffold.dart';
import '../application/address_providers.dart';
import '../domain/address.dart';
import 'address_messages.dart';

/// What a map view needs: the current pin (the camera follows it), whether
/// the customer may move the map, and a callback for the customer's moves.
class MapViewArgs {
  const MapViewArgs({
    required this.value,
    required this.interactive,
    required this.onUserMoved,
  });

  final PinLocation? value;
  final bool interactive;
  final void Function(double latitude, double longitude) onUserMoved;
}

typedef MapViewBuilder =
    Widget Function(BuildContext context, MapViewArgs args);

/// The map under the pin. MapLibre with OpenFreeMap tiles in the app;
/// overridden in widget tests (platform views do not render there).
final mapViewBuilderProvider = Provider<MapViewBuilder>(
  (ref) =>
      (context, args) => MapLibrePinMap(args: args),
);

/// Map with a fixed center pin (spec 05): the customer moves the map under
/// the pin, or starts from the device position and adjusts it. A move by
/// the customer makes the pin `MANUAL`; it stays `GPS` only while it is
/// exactly where the device position put it.
class LocationPicker extends ConsumerStatefulWidget {
  const LocationPicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.interactive = true,
  });

  final PinLocation? value;
  final ValueChanged<PinLocation> onChanged;
  final bool interactive;

  @override
  ConsumerState<LocationPicker> createState() => _LocationPickerState();
}

class _LocationPickerState extends ConsumerState<LocationPicker> {
  bool _locating = false;
  String? _notice;
  bool _noticeIsError = false;

  Future<void> _locate() async {
    final t = AddressMessages.of(context);
    setState(() {
      _locating = true;
      _noticeIsError = false;
      _notice = t.locating;
    });
    final result = await ref.read(deviceLocatorProvider)();
    if (!mounted) return;
    setState(() {
      _locating = false;
      if (result.pin != null) {
        widget.onChanged(result.pin!);
        _notice = t.located;
      } else {
        _noticeIsError = true;
        _notice = t.geolocation(result.failure!);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AddressMessages.of(context);
    final value = widget.value;
    final textTheme = Theme.of(context).textTheme;
    final mapView = ref.watch(mapViewBuilderProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.interactive)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s2),
            child: Text(t.mapHint, style: textTheme.bodySmall),
          ),
        ClipRRect(
          borderRadius: AppRadius.card,
          child: SizedBox(
            height: 280,
            child: Stack(
              children: [
                Positioned.fill(
                  child: mapView(
                    context,
                    MapViewArgs(
                      value: value,
                      interactive: widget.interactive,
                      onUserMoved: (latitude, longitude) {
                        final current = widget.value;
                        if (current != null &&
                            (current.latitude - latitude).abs() < 1e-7 &&
                            (current.longitude - longitude).abs() < 1e-7) {
                          return;
                        }
                        widget.onChanged(
                          PinLocation.manual(latitude, longitude),
                        );
                      },
                    ),
                  ),
                ),
                // The pin's tip marks the map center.
                IgnorePointer(
                  child: Center(
                    child: Transform.translate(
                      offset: const Offset(0, -20),
                      child: Icon(
                        Icons.location_on,
                        size: 40,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.s2),
        if (widget.interactive)
          OutlinedButton.icon(
            key: const Key('address-locate'),
            onPressed: _locating ? null : _locate,
            icon: const Icon(Icons.my_location),
            label: Text(_locating ? t.locating : t.useMyLocation),
          ),
        if (value != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s2),
            child: Text(
              [
                '${value.latitude.toStringAsFixed(6)}, ${value.longitude.toStringAsFixed(6)}',
                if (value.source == LocationSource.gps &&
                    value.accuracyMeters != null)
                  t.gpsAccuracy(value.accuracyMeters!),
                if (value.source == LocationSource.manual) t.manualPin,
              ].join(' · '),
              key: const Key('address-pin-text'),
              textDirection: TextDirection.ltr,
              style: textTheme.bodySmall,
            ),
          ),
        if (_notice != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s2),
            child: AuthMessageText(_notice!, isError: _noticeIsError),
          ),
      ],
    );
  }
}

/// MapLibre view (OpenFreeMap style). Camera moves made by the widget
/// itself are ignored; any other settled move reports the new center.
class MapLibrePinMap extends StatefulWidget {
  const MapLibrePinMap({super.key, required this.args});
  final MapViewArgs args;

  @override
  State<MapLibrePinMap> createState() => _MapLibrePinMapState();
}

class _MapLibrePinMapState extends State<MapLibrePinMap> {
  ml.MapLibreMapController? _controller;
  bool _programmatic = false;

  @override
  void didUpdateWidget(MapLibrePinMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final value = widget.args.value;
    final controller = _controller;
    final target = controller?.cameraPosition?.target;
    if (controller == null || value == null || target == null) return;
    if ((target.latitude - value.latitude).abs() > 1e-6 ||
        (target.longitude - value.longitude).abs() > 1e-6) {
      _programmatic = true;
      controller.moveCamera(
        ml.CameraUpdate.newLatLngZoom(
          ml.LatLng(value.latitude, value.longitude),
          16,
        ),
      );
    }
  }

  void _onIdle() {
    if (_programmatic) {
      _programmatic = false;
      return;
    }
    final target = _controller?.cameraPosition?.target;
    if (target != null && widget.args.interactive) {
      widget.args.onUserMoved(target.latitude, target.longitude);
    }
  }

  @override
  Widget build(BuildContext context) {
    final value = widget.args.value;
    final interactive = widget.args.interactive;
    return ml.MapLibreMap(
      styleString: mapStyleUrl,
      initialCameraPosition: ml.CameraPosition(
        target: ml.LatLng(
          value?.latitude ?? defaultMapLatitude,
          value?.longitude ?? defaultMapLongitude,
        ),
        zoom: value == null ? defaultMapZoom : 16,
      ),
      trackCameraPosition: true,
      onMapCreated: (controller) => _controller = controller,
      onCameraIdle: _onIdle,
      compassEnabled: false,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      scrollGesturesEnabled: interactive,
      zoomGesturesEnabled: interactive,
      dragEnabled: interactive,
    );
  }
}
