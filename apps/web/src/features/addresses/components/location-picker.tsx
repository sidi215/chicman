"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import { DEFAULT_MAP_CENTER } from "@chicman/shared"
import { LocateFixed, MapPin } from "lucide-react"
import type { Map as MapLibreMap } from "maplibre-gl"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"
import { mapStyleUrl } from "@/lib/csp"

import { geolocationFailure, movedPin, type PinLocation } from "../address-form"
import type { AddressMessages } from "../messages"

const STYLE_URL = mapStyleUrl({ NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL })
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs"
const INTERACTION_HANDLERS = ["dragPan", "scrollZoom", "boxZoom", "dragRotate", "keyboard", "doubleClickZoom", "touchZoomRotate"] as const

type Notice = { tone: "info" | "error"; text: string } | null

/**
 * Map with a fixed center pin (spec 05): the customer moves the map under
 * the pin, or starts from the device position ("Utiliser ma position") and
 * adjusts it. Every user move makes the pin `MANUAL`; it stays `GPS` only
 * while it is exactly where the device position put it.
 */
export function LocationPicker({
  t,
  value,
  onChange,
  interactive = true,
}: {
  t: AddressMessages
  value: PinLocation | null
  onChange?: (pin: PinLocation) => void
  interactive?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const onChangeRef = useRef(onChange)
  const initial = useRef(value)
  const valueRef = useRef(value)
  // True while the picker moves the map itself (jumpTo fires moveend synchronously).
  const programmatic = useRef(false)
  const [failed, setFailed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
  }, [onChange, value])

  useEffect(() => {
    let cancelled = false
    let instance: MapLibreMap | null = null
    void (async () => {
      try {
        const maplibre = await import("maplibre-gl")
        if (cancelled || container.current === null) return
        maplibre.setWorkerUrl(WORKER_URL)
        const start = initial.current
        instance = new maplibre.Map({
          container: container.current,
          style: STYLE_URL,
          center: start ? [start.longitude, start.latitude] : [DEFAULT_MAP_CENTER.longitude, DEFAULT_MAP_CENTER.latitude],
          zoom: start ? 16 : DEFAULT_MAP_CENTER.zoom,
          attributionControl: { compact: true },
        })
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right")
        let loaded = false
        instance.on("load", () => {
          loaded = true
        })
        instance.on("error", () => {
          // Only a style that never loads makes the map unusable; tile errors are transient.
          if (!loaded) setFailed(true)
        })
        // Any move not made by the picker itself is the customer's: if it
        // changed the center, the pin is now placed by hand. Zooming alone
        // keeps the center, so a GPS pin stays GPS.
        instance.on("moveend", () => {
          if (programmatic.current) return
          const center = instance?.getCenter()
          if (!center) return
          const pin = valueRef.current
          if (pin && Math.abs(center.lat - pin.latitude) < 1e-7 && Math.abs(center.lng - pin.longitude) < 1e-7) return
          onChangeRef.current?.(movedPin(center.lat, center.lng))
        })
        map.current = instance
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      instance?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    for (const handler of INTERACTION_HANDLERS) {
      if (interactive) instance[handler].enable()
      else instance[handler].disable()
    }
  }, [interactive, failed])

  // Follow external pin changes (GPS result, editing an existing address).
  useEffect(() => {
    const instance = map.current
    if (!instance || value === null) return
    const center = instance.getCenter()
    if (Math.abs(center.lat - value.latitude) > 1e-6 || Math.abs(center.lng - value.longitude) > 1e-6) {
      jump(instance, { center: [value.longitude, value.latitude], zoom: Math.max(instance.getZoom(), 16) })
    }
  }, [value])

  function jump(instance: MapLibreMap, options: Parameters<MapLibreMap["jumpTo"]>[0]) {
    programmatic.current = true
    try {
      instance.jumpTo(options)
    } finally {
      programmatic.current = false
    }
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setNotice({ tone: "error", text: t.geolocation[geolocationFailure(null)] })
      return
    }
    setLocating(true)
    setNotice({ tone: "info", text: t.locating })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const pin: PinLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "GPS",
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        }
        valueRef.current = pin
        if (map.current) jump(map.current, { center: [pin.longitude, pin.latitude], zoom: 17 })
        onChangeRef.current?.(pin)
        setNotice({ tone: "info", text: t.located })
      },
      (error) => {
        setLocating(false)
        setNotice({ tone: "error", text: t.geolocation[geolocationFailure(error.code)] })
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {interactive ? <p className="type-body-small text-muted-foreground">{t.mapHint}</p> : null}
      <div className="relative h-72 w-full overflow-hidden rounded-2xl border border-border bg-muted sm:h-80">
        {/* Sized directly: MapLibre's stylesheet sets `.maplibregl-map { position: relative }`. */}
        <div ref={container} className="h-full w-full" aria-label={t.mapHint} role="application" />
        {failed ? null : (
          // The pin marks the map center; the map moves underneath it.
          <MapPin
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-full fill-primary text-primary-foreground drop-shadow-md"
          />
        )}
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            <FormMessage tone="error">{t.mapUnavailable}</FormMessage>
          </div>
        ) : null}
      </div>
      {interactive ? (
        <Button type="button" variant="outline" onClick={locate} disabled={locating || failed} className="self-start">
          <LocateFixed />
          {locating ? t.locating : t.useMyLocation}
        </Button>
      ) : null}
      {value ? (
        <p className="type-body-small text-muted-foreground" dir="ltr">
          {`${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`}
          {value.source === "GPS" && value.accuracyMeters !== null ? ` · ${t.gpsAccuracy.replace("{m}", String(value.accuracyMeters))}` : ""}
          {value.source === "MANUAL" ? ` · ${t.manualPin}` : ""}
        </p>
      ) : null}
      {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
    </div>
  )
}
