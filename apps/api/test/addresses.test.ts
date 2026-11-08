import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { CustomerAddress, CustomerAddressListResponse } from "@chicman/shared";
import dotenv from "dotenv";

import { TEST_SHOP_FIELDS } from "./helpers/database.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

/** Nouakchott, Tevragh Zeina. */
const GPS = {
  label: "Maison",
  city: "Nouakchott",
  district: "Tevragh Zeina",
  landmark: "Près de la mosquée Ibn Abbas, portail bleu",
  latitude: 18.1012345678,
  longitude: -15.9987654321,
  locationSource: "GPS",
  accuracyMeters: 12.4,
  locationConfirmed: true,
};
const MANUAL = { city: "Nouadhibou", district: "Numerowatt", landmark: "Face à la pharmacie", latitude: 20.94, longitude: -17.03, locationSource: "MANUAL", locationConfirmed: true };

describe("customer addresses (spec 05, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let customer: Actor;

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    customer = await h.actor();
  });

  const create = (actor: Actor, body: unknown) => h.call("/customers/me/addresses", actor.token, { method: "POST", body });
  const list = async (actor: Actor) =>
    ((await (await h.call("/customers/me/addresses", actor.token)).json()) as CustomerAddressListResponse).addresses;
  const created = async (actor: Actor, body: unknown = GPS) => {
    const res = await create(actor, body);
    assert.equal(res.status, 201);
    return (await res.json()) as CustomerAddress;
  };

  describe("adding addresses", () => {
    it("GPS: saves the confirmed location (6 decimals) and details; the first address is the default", async () => {
      const address = await created(customer);
      assert.equal(address.latitude, 18.101235);
      assert.equal(address.longitude, -15.998765);
      assert.equal(address.locationSource, "GPS");
      assert.equal(address.accuracyMeters, 12);
      assert.equal(address.isDefault, true);
      assert.equal(address.deliveryPhone, null);
      assert.ok(address.locationConfirmedAt);
      assert.ok(!("userId" in address));
      const row = await h.prisma.customerAddress.findUniqueOrThrow({ where: { id: address.id } });
      assert.equal(row.userId, customer.userId);
    });

    it("manual pin: saves without accuracy; later addresses are not the default", async () => {
      await created(customer);
      const manual = await created(customer, { ...MANUAL, accuracyMeters: 50, deliveryPhone: "46 00 00 01", label: null });
      assert.equal(manual.locationSource, "MANUAL");
      assert.equal(manual.accuracyMeters, null);
      assert.equal(manual.deliveryPhone, "+22246000001");
      assert.equal(manual.label, null);
      assert.equal(manual.isDefault, false);
    });

    it("refuses an unconfirmed location, out-of-area pins, and invalid or protected fields; nothing is written", async () => {
      const cases: [unknown, number, string?][] = [
        [{ ...GPS, locationConfirmed: undefined }, 400, "ADDRESS_LOCATION_NOT_CONFIRMED"],
        [{ ...GPS, locationConfirmed: false }, 400, "ADDRESS_LOCATION_NOT_CONFIRMED"],
        [{ ...GPS, latitude: 48.85, longitude: 2.35 }, 400, "ADDRESS_OUTSIDE_SERVICE_AREA"],
        [{ ...GPS, latitude: 91 }, 400],
        [{ ...GPS, longitude: "x" }, 400],
        [{ ...GPS, city: "" }, 400],
        [{ ...GPS, district: "  " }, 400],
        [{ ...GPS, landmark: "x".repeat(301) }, 400],
        [{ ...GPS, label: "x".repeat(51) }, 400],
        [{ ...GPS, landmark: "bip\u0007" }, 400],
        [{ ...GPS, deliveryPhone: "123" }, 400],
        [{ ...GPS, locationSource: "IP" }, 400],
        [{ ...GPS, userId: randomUUID() }, 400],
        [{ ...GPS, isDefault: true }, 400],
        [{ ...GPS, id: randomUUID() }, 400],
        [{ ...GPS, locationConfirmedAt: new Date().toISOString() }, 400],
      ];
      for (const [body, status, code] of cases) {
        const res = await create(customer, body);
        assert.equal(res.status, status, JSON.stringify(body));
        if (code) assert.deepEqual(await res.json(), { error: { code } });
      }
      assert.equal(await h.prisma.customerAddress.count(), 0);
    });

    it("at most 10 addresses, also under concurrent creation", async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () => create(customer, MANUAL)));
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 201).length, 10);
      assert.equal(statuses.filter((s) => s === 409).length, 2);
      assert.equal(await h.prisma.customerAddress.count({ where: { userId: customer.userId } }), 10);
      assert.equal(await h.prisma.customerAddress.count({ where: { userId: customer.userId, isDefault: true } }), 1);
    });

    it("the database keeps one default per customer and the service area", async () => {
      const address = await created(customer);
      await assert.rejects(
        h.prisma.customerAddress.create({
          data: { ...MANUAL, userId: customer.userId, locationConfirmedAt: new Date(), isDefault: true, locationConfirmed: undefined } as never,
        }),
      );
      await assert.rejects(h.prisma.customerAddress.update({ where: { id: address.id }, data: { latitude: 48.85 } }));
    });

    it("a failed write rolls back", async () => {
      h.faults.address.beforeCommit = () => {
        throw new Error("injected");
      };
      assert.equal((await create(customer, GPS)).status, 500);
      delete h.faults.address.beforeCommit;
      assert.equal(await h.prisma.customerAddress.count(), 0);
    });
  });

  describe("viewing, editing, deleting", () => {
    it("lists the default first, then the most recently updated", async () => {
      const first = await created(customer);
      const second = await created(customer, MANUAL);
      const third = await created(customer, { ...MANUAL, landmark: "Troisième" });
      assert.deepEqual(
        (await list(customer)).map((a) => a.id),
        [first.id, third.id, second.id],
      );
      assert.deepEqual(await (await h.call(`/customers/me/addresses/${second.id}`, customer.token)).json(), second);
    });

    it("edits details without touching the location; a moved pin needs a new confirmation", async () => {
      const address = await created(customer);
      const res = await h.call(`/customers/me/addresses/${address.id}`, customer.token, {
        method: "PATCH",
        body: { landmark: "  Nouveau repère  ", label: null, deliveryPhone: "+22246111111" },
      });
      assert.equal(res.status, 200);
      const edited = (await res.json()) as CustomerAddress;
      assert.equal(edited.landmark, "Nouveau repère");
      assert.equal(edited.label, null);
      assert.equal(edited.latitude, address.latitude);
      assert.equal(edited.locationConfirmedAt, address.locationConfirmedAt);

      const unconfirmed = await h.call(`/customers/me/addresses/${address.id}`, customer.token, {
        method: "PATCH",
        body: { latitude: 18.2, longitude: -15.9, locationSource: "MANUAL" },
      });
      assert.equal(unconfirmed.status, 400);
      assert.deepEqual(await unconfirmed.json(), { error: { code: "ADDRESS_LOCATION_NOT_CONFIRMED" } });
      for (const body of [{ latitude: 18.2 }, { locationConfirmed: true }, {}, { isDefault: true }, { userId: randomUUID() }]) {
        assert.equal(
          (await h.call(`/customers/me/addresses/${address.id}`, customer.token, { method: "PATCH", body })).status,
          400,
          JSON.stringify(body),
        );
      }
      const moved = await h.call(`/customers/me/addresses/${address.id}`, customer.token, {
        method: "PATCH",
        body: { latitude: 18.2, longitude: -15.9, locationSource: "MANUAL", locationConfirmed: true },
      });
      assert.equal(moved.status, 200);
      const after = (await moved.json()) as CustomerAddress;
      assert.equal(after.latitude, 18.2);
      assert.equal(after.locationSource, "MANUAL");
      assert.equal(after.accuracyMeters, null);
      assert.ok(after.locationConfirmedAt > address.locationConfirmedAt);
    });

    it("an accuracy-only patch applies to a GPS pin and never puts an accuracy on a manual pin", async () => {
      const patchAccuracy = async (id: string): Promise<CustomerAddress> => {
        const res = await h.call(`/customers/me/addresses/${id}`, customer.token, { method: "PATCH", body: { accuracyMeters: 30 } });
        assert.equal(res.status, 200);
        return (await res.json()) as CustomerAddress;
      };
      const gps = await created(customer);
      assert.equal((await patchAccuracy(gps.id)).accuracyMeters, 30);
      const manual = await created(customer, { ...MANUAL });
      assert.equal((await patchAccuracy(manual.id)).accuracyMeters, null);
    });

    it("sets another default, and deleting the default promotes the most recently updated address", async () => {
      const first = await created(customer);
      const second = await created(customer, MANUAL);
      const third = await created(customer, { ...MANUAL, landmark: "Troisième" });
      const res = await h.call(`/customers/me/addresses/${second.id}/default`, customer.token, { method: "POST" });
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as CustomerAddress).isDefault, true);
      assert.deepEqual(
        (await list(customer)).filter((a) => a.isDefault).map((a) => a.id),
        [second.id],
      );
      // A default switch is not an edit: updatedAt values are unchanged.
      const stamps = await h.prisma.customerAddress.findMany({ where: { userId: customer.userId }, select: { id: true, updatedAt: true } });
      for (const stamp of stamps) {
        const original = [first, second, third].find((a) => a.id === stamp.id);
        assert.equal(stamp.updatedAt.toISOString(), original?.updatedAt);
      }
      // Setting the current default again is harmless.
      assert.equal((await h.call(`/customers/me/addresses/${second.id}/default`, customer.token, { method: "POST" })).status, 200);

      assert.equal((await h.call(`/customers/me/addresses/${second.id}`, customer.token, { method: "DELETE" })).status, 204);
      const remaining = await list(customer);
      assert.deepEqual(
        remaining.map((a) => [a.id, a.isDefault]),
        [
          [third.id, true],
          [first.id, false],
        ],
      );
      await h.call(`/customers/me/addresses/${third.id}`, customer.token, { method: "DELETE" });
      await h.call(`/customers/me/addresses/${first.id}`, customer.token, { method: "DELETE" });
      assert.deepEqual(await list(customer), []);
    });

    it("concurrent default changes leave exactly one default", async () => {
      const ids = [(await created(customer)).id, (await created(customer, MANUAL)).id, (await created(customer, MANUAL)).id];
      const results = await Promise.all(ids.map((id) => h.call(`/customers/me/addresses/${id}/default`, customer.token, { method: "POST" })));
      assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
      assert.equal(await h.prisma.customerAddress.count({ where: { userId: customer.userId, isDefault: true } }), 1);
    });
  });

  describe("ownership and access", () => {
    it("a customer never reads or changes another customer's address (404); unknown IDs are 404", async () => {
      const other = await h.actor();
      const theirs = await created(other);
      for (const [method, path, body] of [
        ["GET", `/customers/me/addresses/${theirs.id}`, undefined],
        ["PATCH", `/customers/me/addresses/${theirs.id}`, { landmark: "piraté" }],
        ["DELETE", `/customers/me/addresses/${theirs.id}`, undefined],
        ["POST", `/customers/me/addresses/${theirs.id}/default`, undefined],
        ["GET", `/customers/me/addresses/${randomUUID()}`, undefined],
        ["GET", "/customers/me/addresses/not-a-uuid", undefined],
      ] as const) {
        const res = await h.call(path, customer.token, { method, ...(body === undefined ? {} : { body }) });
        assert.equal(res.status, 404, `${method} ${path}`);
        assert.deepEqual(await res.json(), { error: { code: "ADDRESS_NOT_FOUND" } });
      }
      assert.deepEqual(await list(customer), []);
      const unchanged = await h.prisma.customerAddress.findUniqueOrThrow({ where: { id: theirs.id } });
      assert.equal(unchanged.landmark, GPS.landmark);
      assert.equal(unchanged.userId, other.userId);
    });

    it("unauthenticated → 401; a token without account setup → 403", async () => {
      assert.equal((await h.call("/customers/me/addresses", null)).status, 401);
      assert.equal((await create({ ...customer, token: "" } as Actor, GPS)).status, 401);
      // A user row without bootstrap does not exist: the auth guard refuses before any address logic.
      await h.prisma.customerProfile.deleteMany({ where: { userId: customer.userId } });
      await h.prisma.userRole.deleteMany({ where: { userId: customer.userId } });
      await h.prisma.user.delete({ where: { id: customer.userId } });
      assert.equal((await h.call("/customers/me/addresses", customer.token)).status, 403);
    });

    it("roles add nothing: a seller and an admin manage only their own addresses; shops are unaffected", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const admin = await h.actor(["CUSTOMER", "ADMIN"]);
      const sellerAddress = await created(owner);
      assert.equal((await h.call(`/customers/me/addresses/${sellerAddress.id}`, admin.token)).status, 404);
      assert.deepEqual(await list(admin), []);
      // The shop's business address (spec 06) is separate and unchanged.
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      assert.equal(shop.address, TEST_SHOP_FIELDS.address);
      assert.equal((await h.call("/sellers/me/shop", owner.token)).status, 200);
    });
  });
});
