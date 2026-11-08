import 'package:chicman/features/addresses/presentation/location_picker.dart';
import 'package:flutter/material.dart';

/// Stands in for the MapLibre platform view, which does not render in
/// widget tests. Its button simulates the customer moving the map so the
/// pin ends on [moveTo].
Widget fakeMapView(
  BuildContext context,
  MapViewArgs args, {
  (double, double) moveTo = (18.0901, -15.9702),
}) => ColoredBox(
  color: Colors.grey,
  child: Center(
    child: TextButton(
      key: const Key('fake-map-move'),
      onPressed: args.interactive
          ? () => args.onUserMoved(moveTo.$1, moveTo.$2)
          : null,
      child: Text(args.interactive ? 'move map' : 'map locked'),
    ),
  ),
);

final fakeMapOverride = mapViewBuilderProvider.overrideWithValue(fakeMapView);
