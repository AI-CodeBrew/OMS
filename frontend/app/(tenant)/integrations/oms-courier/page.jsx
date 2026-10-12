"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import Modal from "../../../../components/shared/Modal";
import integrationsService from "../../../../services/integrationsService";
import {
  Badge,
  BarqRaftarWordmark,
  PostExWordmark,
  SmartlaneLogo,
} from "../../../../components/integrations/IntegrationLogos";
import SmartlaneBusinessForm from "./_components/SmartlaneBusinessForm";
import PostExAddressForm from "./_components/PostExAddressForm";
import BarqRaftarAddressForm from "./_components/BarqRaftarAddressForm";

// FynkTech dispatches the store's orders through its own account for each
// courier turned on here and approved by FynkTech on its Requests page
// (backend integrations/oms_courier_views.py, oms_courier_service.py).
// Smartlane is asked for with the full business details its onboarding
// needs (the same form as before); PostEx and BarqRaftar with their own
// pickup-address forms, which become the store's pickup address on
// FynkTech's account for that courier once approved.
const COURIERS = [
  {
    key: "smartlane",
    name: "Smartlane",
    tagline: "Leopards, BlueEx and more through Smartlane.",
    logo: SmartlaneLogo,
  },
  {
    key: "postex",
    name: "PostEx",
    tagline: "Nationwide COD deliveries with PostEx.",
    logo: PostExWordmark,
    wordmark: true,
  },
  {
    key: "barq_raftar",
    name: "BarqRaftar",
    tagline: "Fast same-city and domestic deliveries.",
    logo: BarqRaftarWordmark,
    wordmark: true,
  },
];

const SMARTLANE_FORM_ID = "oms-courier-smartlane-form";

// The couriers asked for with their own pickup-address form: the form, what
// the courier calls the address once approved, and a first form's prefill.
const ADDRESS_FORMS = {
  postex: {
    formId: "oms-courier-postex-form",
    Form: PostExAddressForm,
    referenceLabel: "PostEx address code",
    prefill: (storeName) => ({ shipper_name: storeName }),
  },
  barq_raftar: {
    formId: "oms-courier-barqraftar-form",
    Form: BarqRaftarAddressForm,
    referenceLabel: "BarqRaftar pickup address ID",
    prefill: (storeName) => ({ name: storeName }),
  },
};

// The request body that re-sends a courier's saved details as they are -
// its own address form, or Smartlane's generic three fields.
function savedForm(courierKey, enrollment) {
  if (ADDRESS_FORMS[courierKey]) return { ...(enrollment.details || {}) };
  return {
    store_name: enrollment.store_name,
    phone: enrollment.phone,
    pickup_address: enrollment.pickup_address,
  };
}

// Smartlane onboarding the store can still edit - nothing sent yet, or sent
// back with a reason. Anything else is with a reviewer.
function smartlaneEditable(link) {
  return !link?.status || link.status === "draft" || link.status === "rejected";
}

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// Where the store's request stands, and FynkTech's answer.
function RequestStatus({ enrollment, onResubmit }) {
  if (!enrollment) return null;
  const { status, is_enabled: enabled, review_note: note } = enrollment;
  if (status === "rejected") {
    return (
      <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        <p>
          <span className="font-medium">Request rejected.</span>
          {note ? ` ${note}` : ""}
        </p>
        <button type="button" onClick={onResubmit} className="mt-1 text-xs font-medium underline">
          Edit and resubmit
        </button>
      </div>
    );
  }
  if (!enabled) return null;
  if (status === "pending") {
    return (
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Request pending - FynkTech will review it, and their answer shows up here.
      </p>
    );
  }
  return note ? (
    <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
      <span className="font-medium">Message from FynkTech:</span> {note}
    </p>
  ) : null;
}

const STATUS_PILL = {
  pending: { text: "Request pending", className: "bg-amber-50 text-amber-700" },
  approved: { text: "Approved", className: "bg-green-100 text-green-700" },
  rejected: { text: "Rejected", className: "bg-red-50 text-red-700" },
};

// Couriers whose order statuses the store can pull on demand (Smartlane's
// come through its own webhook and poller).
const SYNCABLE = new Set(["postex", "barq_raftar"]);

// One courier per row - logo, details and FynkTech's answer, then the switch.
function CourierCard({ courier, enrollment, onboarding, busy, syncing, onToggle, onEdit, onResubmit, onSync }) {
  const enabled = Boolean(enrollment?.is_enabled);
  const isSmartlane = courier.key === "smartlane";
  const canSync = enabled && enrollment?.status === "approved" && SYNCABLE.has(courier.key);
  const unavailable = isSmartlane && onboarding && !onboarding.available;
  const pill =
    enrollment && (enabled || enrollment.status === "rejected") ? STATUS_PILL[enrollment.status] : null;
  const showDetails = enrollment && (enabled || enrollment.status === "rejected");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-surface-border bg-white p-5 sm:flex-row sm:items-start">
      <Badge Logo={courier.logo} wordmark={courier.wordmark} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900">{courier.name}</h3>
          {pill ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pill.className}`}>
              {pill.text}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-500">{courier.tagline}</p>
        {unavailable ? (
          <p className="mt-2 text-xs text-slate-400">Not available yet - check back later.</p>
        ) : null}
        {showDetails ? (
          <p className="mt-2 text-xs text-slate-600">
            {[enrollment.store_name, enrollment.phone, enrollment.pickup_address]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {enrollment?.courier_reference && enrollment.status === "approved" ? (
          <p className="mt-1 text-xs text-slate-500">
            {ADDRESS_FORMS[courier.key]?.referenceLabel || "Reference"}:{" "}
            <span className="font-mono font-medium">{enrollment.courier_reference}</span>
          </p>
        ) : null}
        <RequestStatus enrollment={enrollment} onResubmit={() => onResubmit(courier)} />
        <div className="mt-2 flex flex-wrap gap-4 text-xs font-medium">
          {enabled && !isSmartlane ? (
            <button type="button" onClick={() => onEdit(courier)} className="text-brand-700 hover:underline">
              Edit details
            </button>
          ) : null}
          {canSync ? (
            <button
              type="button"
              onClick={() => onSync(courier)}
              disabled={syncing}
              className="text-brand-700 hover:underline disabled:cursor-wait disabled:text-slate-400 disabled:no-underline"
            >
              {syncing ? "Syncing…" : "Sync statuses now"}
            </button>
          ) : null}
          {isSmartlane && onboarding?.link?.status && onboarding.link.status !== "draft" ? (
            <Link
              href="/integrations/oms-courier/smartlane-business"
              className="text-brand-700 hover:underline"
            >
              Business details →
            </Link>
          ) : null}
        </div>
      </div>
      <Toggle
        checked={enabled}
        disabled={busy || unavailable}
        onChange={(next) => onToggle(courier, next)}
        label={`Enable ${courier.name}`}
      />
    </div>
  );
}

// The dialog for a courier asked for with its own pickup-address form.
function AddressRequestModal({ courier, enrollment, storeName, saving, error, onClose, onSubmit }) {
  const config = courier ? ADDRESS_FORMS[courier.key] : null;
  const editing = Boolean(enrollment?.is_enabled);
  const hasSaved = enrollment?.details && Object.keys(enrollment.details).length;
  return (
    <Modal
      open={Boolean(config)}
      onClose={onClose}
      title={courier ? `${editing ? "Edit" : "Request"} ${courier.name}${editing ? " address" : ""}` : ""}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={config?.formId} loading={saving}>
            {editing ? "Save" : "Send request"}
          </Button>
        </>
      }
    >
      {config ? (
        <>
          <p className="text-xs text-slate-500">
            Your pickup address for {courier.name}. Once FynkTech approves the request it&apos;s
            added to FynkTech&apos;s {courier.name} account, and every one of your {courier.name}{" "}
            orders - booked by FynkTech or by you - is picked up from it.
            {editing ? " Changing it sends the request for review again." : ""}
          </p>
          {error ? (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          <div className="mt-4">
            <config.Form
              formId={config.formId}
              initial={hasSaved ? enrollment.details : config.prefill(storeName || "")}
              addressCode={enrollment?.courier_reference}
              pickupAddressId={enrollment?.courier_reference}
              onSubmit={onSubmit}
            />
          </div>
        </>
      ) : null}
    </Modal>
  );
}

export default function OmsCourierPage() {
  const [enrollments, setEnrollments] = useState({});
  const [defaults, setDefaults] = useState({});
  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The open dialog: the courier being enabled/edited, or null.
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [syncingKey, setSyncingKey] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [couriers, onboardingData] = await Promise.all([
        integrationsService.getOmsCourierCouriers(),
        integrationsService.getOmsCourierOnboarding().catch(() => null),
      ]);
      setEnrollments(Object.fromEntries((couriers.couriers || []).map((c) => [c.courier, c])));
      setDefaults(couriers.defaults || {});
      setOnboarding(onboardingData);
    } catch (err) {
      setError(err.message || "Failed to load OMS Courier");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openDialog(courier) {
    setDialog(courier);
    setDialogError("");
    setError("");
    setNotice("");
  }

  function closeDialog() {
    if (saving) return;
    setDialog(null);
  }

  async function saveEnrollment(courier, body, message) {
    setBusyKey(courier.key);
    setError("");
    setNotice("");
    try {
      const saved = await integrationsService.saveOmsCourierCourier(courier.key, body);
      setEnrollments((prev) => ({ ...prev, [courier.key]: saved }));
      setNotice(message);
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setBusyKey("");
    }
  }

  async function onToggle(courier, next) {
    if (!next) {
      if (
        !window.confirm(
          `Turn off ${courier.name}? FynkTech will stop booking your orders with ${courier.name}.`
        )
      ) {
        return;
      }
      await saveEnrollment(courier, { is_enabled: false }, `${courier.name} turned off.`);
      return;
    }

    const existing = enrollments[courier.key];
    if (existing?.status === "approved") {
      // Already approved - back on unchanged, no new request.
      await saveEnrollment(
        courier,
        { is_enabled: true, ...savedForm(courier.key, existing) },
        `${courier.name} turned back on.`
      );
      return;
    }
    await requestCourier(courier);
  }

  // A fresh request - through the form, unless Smartlane's business details
  // are already with FynkTech and can't be edited (it then asks again with
  // them as they are).
  async function requestCourier(courier) {
    const link = onboarding?.link;
    if (courier.key === "smartlane" && !smartlaneEditable(link)) {
      const existing = enrollments.smartlane;
      const kyc = link?.kyc || {};
      await saveEnrollment(
        courier,
        {
          is_enabled: true,
          store_name: existing?.store_name || kyc.name || "",
          phone: existing?.phone || kyc.poc_phone || "",
          pickup_address:
            existing?.pickup_address || [kyc.address, kyc.city].filter(Boolean).join(", "),
        },
        "Smartlane requested - FynkTech will review it."
      );
      return;
    }
    openDialog(courier);
  }

  // Saves the open dialog's address form.
  async function saveDialog(values) {
    if (!dialog) return;
    setSaving(true);
    setDialogError("");
    try {
      const saved = await integrationsService.saveOmsCourierCourier(dialog.key, {
        is_enabled: true,
        ...values,
      });
      setEnrollments((prev) => ({ ...prev, [dialog.key]: saved }));
      setNotice(
        saved.status === "pending"
          ? `${dialog.name} requested - FynkTech will review it and answer here.`
          : `${dialog.name} saved.`
      );
      setDialog(null);
    } catch (err) {
      setDialogError(err.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function onSync(courier) {
    setSyncingKey(courier.key);
    setError("");
    setNotice("");
    try {
      const result = await integrationsService.syncOmsCourierCourier(courier.key);
      setNotice(
        result.checked
          ? `${courier.name} sync finished: checked ${result.checked}, updated ${result.updated}.`
          : `No open ${courier.name} orders to check.`
      );
    } catch (err) {
      setError(err.message || `Could not sync ${courier.name}`);
    } finally {
      setSyncingKey("");
    }
  }

  async function onSmartlaneSubmitted() {
    setDialog(null);
    setNotice("Smartlane requested - your business details were sent to FynkTech for review.");
    await load();
  }

  const isSmartlaneDialog = dialog?.key === "smartlane";
  const rejected = onboarding?.link?.status === "rejected";

  return (
    <div>
      <Link href="/integrations" className="text-sm font-medium text-brand-600 hover:underline">
        ← Integrations
      </Link>

      <div className="mt-3">
        <h1 className="text-[28px] font-semibold leading-8 text-slate-900">OMS Courier</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Let FynkTech dispatch your orders through its own courier accounts - no courier signup
          of your own. Turn on the couriers you want and add your details; tracking numbers and
          status updates show on your orders as they happen.
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-6 max-w-4xl space-y-4">
          {COURIERS.map((courier) => (
            <CourierCard
              key={courier.key}
              courier={courier}
              enrollment={enrollments[courier.key]}
              onboarding={onboarding}
              busy={busyKey === courier.key}
              syncing={syncingKey === courier.key}
              onToggle={onToggle}
              onEdit={openDialog}
              onResubmit={requestCourier}
              onSync={onSync}
            />
          ))}
        </div>
      )}

      <Modal
        open={isSmartlaneDialog}
        onClose={closeDialog}
        title={rejected ? "Resubmit Smartlane request" : "Request Smartlane"}
        width="max-w-3xl"
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form={SMARTLANE_FORM_ID} loading={saving}>
              {rejected ? "Resubmit request" : "Send request"}
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-500">
          Business details - we need these to set up your courier account. Fields marked * are
          required. FynkTech reviews your request and answers on this page.
        </p>
        {rejected && onboarding?.link?.review_note ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="font-medium">Reason:</span> {onboarding.link.review_note}
          </p>
        ) : null}
        {dialogError ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p>
        ) : null}
        <div className="mt-4">
          {isSmartlaneDialog ? (
            <SmartlaneBusinessForm
              formId={SMARTLANE_FORM_ID}
              initialKyc={onboarding?.link?.kyc}
              editable
              onSubmitted={onSmartlaneSubmitted}
              onError={setDialogError}
              onSavingChange={setSaving}
            />
          ) : null}
        </div>
      </Modal>

      <AddressRequestModal
        courier={dialog && ADDRESS_FORMS[dialog.key] ? dialog : null}
        enrollment={dialog ? enrollments[dialog.key] : null}
        storeName={defaults.store_name}
        saving={saving}
        error={dialogError}
        onClose={closeDialog}
        onSubmit={saveDialog}
      />
    </div>
  );
}
