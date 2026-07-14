'use client';

import { formatDate } from '@/lib/format';

export interface PrintItem {
  product_name: string;
  product_sku?: string;
  quantity: number;
  unit_price: number;
  discount_percent?: number;
  subtotal: number;
  unit_name?: string;
}

export interface PrintMetaField {
  label: string;
  value: string;
}

export interface PrintPayment {
  payment_number: string;
  payment_date: string;
  amount: number;
  payment_method: string;
}

export interface PrintTemplateProps {
  docType: 'INVOICE' | 'QUOTATION' | 'SALES ORDER';
  docNumber: string;
  docDate: string;
  dueDate?: string;
  expiryDate?: string;
  status?: string;
  company: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    logo_url?: string;
    website?: string;
  };
  customer: {
    name: string;
    code?: string;
    phone?: string;
    address?: string;
  };
  items: PrintItem[];
  subtotal: number;
  discountTotal?: number;
  totalAmount: number;
  amountPaid?: number;
  balanceDue?: number;
  notes?: string;
  payments?: PrintPayment[];
  metaFields?: PrintMetaField[];
}

const PRIMARY = '#1e3a6e';
const GREEN = '#4caf50';

const fmt = (n: number) =>
  '৳' +
  Number(n).toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function QRPlaceholder() {
  const blocks = [
    [1,1,1,0,1,1,1],
    [1,0,1,0,1,0,1],
    [1,0,1,0,1,0,1],
    [1,1,1,0,1,1,1],
    [0,1,0,1,0,1,0],
    [1,0,1,0,1,0,0],
    [1,1,1,0,0,1,1],
  ];
  const cell = 10;
  return (
    <svg width={7 * cell} height={7 * cell} viewBox={`0 0 ${7 * cell} ${7 * cell}`} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <rect width={7 * cell} height={7 * cell} fill="#fff" />
      {blocks.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill={PRIMARY} /> : null
        )
      )}
      <rect x={0} y={0} width={30} height={30} fill="none" stroke={PRIMARY} strokeWidth={2} />
      <rect x={40} y={0} width={30} height={30} fill="none" stroke={PRIMARY} strokeWidth={2} />
      <rect x={0} y={40} width={30} height={30} fill="none" stroke={PRIMARY} strokeWidth={2} />
    </svg>
  );
}

const statusConfig: Record<string, { bg: string; color: string }> = {
  paid:            { bg: GREEN,      color: '#fff' },
  partially_paid:  { bg: '#f59e0b',  color: '#fff' },
  partial:         { bg: '#f59e0b',  color: '#fff' },
  draft:           { bg: '#9ca3af',  color: '#fff' },
  sent:            { bg: '#3b82f6',  color: '#fff' },
  viewed:          { bg: '#3b82f6',  color: '#fff' },
  overdue:         { bg: '#ef4444',  color: '#fff' },
  cancelled:       { bg: '#6b7280',  color: '#fff' },
  accepted:        { bg: GREEN,      color: '#fff' },
  rejected:        { bg: '#ef4444',  color: '#fff' },
  converted:       { bg: '#8b5cf6',  color: '#fff' },
};

export default function PrintTemplate({
  docType,
  docNumber,
  docDate,
  dueDate,
  expiryDate,
  status,
  company,
  customer,
  items,
  subtotal,
  discountTotal = 0,
  totalAmount,
  amountPaid = 0,
  balanceDue = 0,
  notes,
  payments,
  metaFields,
}: PrintTemplateProps) {
  const normalizedStatus = (status || '').toLowerCase().replace(/\s+/g, '_');
  const badge = statusConfig[normalizedStatus] || { bg: PRIMARY, color: '#fff' };
  const isPaid = normalizedStatus === 'paid';

  const salesPerson =
    metaFields?.find((f) => /sales|person/i.test(f.label))?.value || 'Admin';

  const paymentMethod =
    payments?.[0]?.payment_method?.replace(/_/g, ' ') ||
    metaFields?.find((f) => /payment/i.test(f.label))?.value ||
    '';

  const isQuote = docType === 'QUOTATION';
  const effectiveDueDate = dueDate || expiryDate;

  const logoSrc = company.logo_url || '/Whats-App-Image-2026-07-09-at-15-57-58.jpg';

  return (
    <>
      {/* Print-specific global styles */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 8mm;
          }
          body * { visibility: hidden !important; }
          .print-document, .print-document * { visibility: visible !important; }
          .print-document {
           position: static !important;
            width: 100% !important;
            max-width: 100% !important;
           margin: 0 auto;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
          .print-header-logo {
            height: 52px !important;
          }
          .print-header-section {
            padding: 8px 16px !important;
          }
          .print-no-break {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .print-items-table {
            page-break-inside: auto;
          }
          .print-items-table tr {
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-after: auto;
          }
          .print-footer-section {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .print-totals-section {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          /* Compact print overrides to fit on one A4 page */
          .print-document img.print-header-logo { height: 52px !important; }
          .print-info-section td { padding-bottom: 1px !important; }
          .print-items-table td, .print-items-table th { padding-top: 2px !important; padding-bottom: 2px !important; }
        }
      `}</style>

      <div
        className="print-document"
        style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#222',
          background: '#fff',
          maxWidth: '800px',
          margin: '0 auto',
          border: '1px solid #dde3ef',
          borderRadius: '4px',
          overflow: 'visible',
          boxSizing: 'border-box',
        }}
      >
        {/* ═══════════════════ HEADER ═══════════════════ */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 20px',
            borderBottom: `3px solid ${PRIMARY}`,
            background: '#fff',
            gap: '14px',
          }}
        >
          {/* Left: Logo image */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <img
              src={logoSrc}
              alt="SI Building Solutions"
              className="print-header-logo"
              style={{
                height: '72px',
                width: 'auto',
                maxWidth: '380px',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>

          {/* Vertical divider */}
          <div
            style={{
              width: '1.5px',
              alignSelf: 'stretch',
              background: '#ccc',
              flexShrink: 0,
              margin: '4px 0',
            }}
          />

          {/* Right: Doc type title + status badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: '28px',
                fontWeight: '900',
                color: PRIMARY,
                letterSpacing: '2px',
                lineHeight: '1.1',
              }}
            >
              {docType}
            </div>

            {status && (
              <div
                style={{
                  background: badge.bg,
                  color: badge.color,
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontWeight: '700',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {/* Circle checkmark icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" fill="rgba(255,255,255,0.25)" />
                  <path
                    d="M8 12l3 3 5-6"
                    stroke="#fff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {status.toUpperCase().replace(/_/g, ' ')}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════ INFO SECTION ═══════════════════ */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            borderBottom: `2px solid ${PRIMARY}`,
          }}
        >
          {/* Bill To */}
          <div style={{ padding: '8px 16px', borderRight: '1px solid #dde3ef' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '6px',
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  background: PRIMARY,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="7" r="4" stroke="#fff" strokeWidth="2" />
                </svg>
              </div>
              <span style={{ fontWeight: '800', fontSize: '11px', color: PRIMARY, letterSpacing: '1.5px' }}>
                BILL TO
              </span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <tbody>
                <tr>
                  <td style={{ color: '#666', paddingBottom: '2px', whiteSpace: 'nowrap', paddingRight: '6px' }}>Customer Name</td>
                  <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '4px' }}>:</td>
                  <td style={{ fontWeight: '700', paddingBottom: '2px' }}>{customer.name}</td>
                </tr>
                {customer.code && (
                  <tr>
                    <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '6px' }}>Customer ID</td>
                    <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '4px' }}>:</td>
                    <td style={{ fontWeight: '700', paddingBottom: '2px' }}>{customer.code}</td>
                  </tr>
                )}
                {customer.phone && (
                  <tr>
                    <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '6px' }}>Phone</td>
                    <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '4px' }}>:</td>
                    <td style={{ fontWeight: '700', paddingBottom: '2px' }}>{customer.phone}</td>
                  </tr>
                )}
                {customer.address && (
                  <tr>
                    <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '6px', verticalAlign: 'top' }}>Address</td>
                    <td style={{ color: '#666', paddingBottom: '2px', paddingRight: '4px', verticalAlign: 'top' }}>:</td>
                    <td style={{ fontWeight: '700', paddingBottom: '2px' }}>{customer.address}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Company Info */}
          <div style={{ padding: '8px 16px', borderRight: '1px solid #dde3ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  background: PRIMARY,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="#fff" strokeWidth="2" />
                  <circle cx="12" cy="10" r="3" stroke="#fff" strokeWidth="2" />
                </svg>
              </div>
              <span style={{ fontWeight: '800', fontSize: '11px', color: PRIMARY, letterSpacing: '1px' }}>
                {company.name.toUpperCase()}
              </span>
            </div>

            {company.address && (
              <div style={{ fontSize: '11px', color: '#444', lineHeight: '1.5', marginBottom: '6px' }}>
                {company.address}
              </div>
            )}

            {company.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginBottom: '3px', color: '#333' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.37 11.5 19.79 19.79 0 0 1 1.25 2.85 2 2 0 0 1 3.22 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z" stroke={PRIMARY} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span style={{ fontWeight: '600' }}>{company.phone}</span>
              </div>
            )}

            {company.email && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#333' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="20" height="16" rx="2" stroke={PRIMARY} strokeWidth="2" />
                  <path d="M2 7l10 7 10-7" stroke={PRIMARY} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span style={{ fontWeight: '600' }}>{company.email}</span>
              </div>
            )}
          </div>

          {/* Invoice Details */}
          <div style={{ padding: '8px 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <tbody>
                <tr>
                  <td style={{ color: '#555', paddingBottom: '3px', whiteSpace: 'nowrap' }}>
                    {isQuote ? 'Quotation No.' : 'Invoice No.'}
                  </td>
                  <td style={{ color: '#555', paddingBottom: '3px', textAlign: 'center', width: '16px' }}>:</td>
                  <td style={{ fontWeight: '800', color: PRIMARY, paddingBottom: '3px', textAlign: 'right' }}>
                    {docNumber}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: '#555', paddingBottom: '3px' }}>Invoice Date</td>
                  <td style={{ color: '#555', paddingBottom: '3px', textAlign: 'center' }}>:</td>
                  <td style={{ fontWeight: '600', paddingBottom: '3px', textAlign: 'right' }}>
                    {formatDate(docDate)}
                  </td>
                </tr>
                {effectiveDueDate && (
                  <tr>
                    <td style={{ color: '#555', paddingBottom: '3px' }}>
                      {isQuote ? 'Valid Until' : 'Due Date'}
                    </td>
                    <td style={{ color: '#555', paddingBottom: '3px', textAlign: 'center' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '3px', textAlign: 'right' }}>
                      {formatDate(effectiveDueDate)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={{ color: '#555', paddingBottom: '3px' }}>Sales Person</td>
                  <td style={{ color: '#555', paddingBottom: '3px', textAlign: 'center' }}>:</td>
                  <td style={{ fontWeight: '600', paddingBottom: '3px', textAlign: 'right' }}>
                    {salesPerson}
                  </td>
                </tr>
                {paymentMethod && (
                  <tr>
                    <td style={{ color: '#555', paddingBottom: '3px', whiteSpace: 'nowrap' }}>Payment Method</td>
                    <td style={{ color: '#555', paddingBottom: '3px', textAlign: 'center' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '3px', textAlign: 'right', textTransform: 'capitalize' }}>
                      {paymentMethod}
                    </td>
                  </tr>
                )}
                {metaFields
                  ?.filter((f) => !/sales|person|payment/i.test(f.label))
                  .map((f, i) => (
                    <tr key={i}>
                      <td style={{ color: '#555', paddingBottom: '3px' }}>{f.label}</td>
                      <td style={{ color: '#555', paddingBottom: '3px', textAlign: 'center' }}>:</td>
                      <td style={{ fontWeight: '600', paddingBottom: '3px', textAlign: 'right' }}>{f.value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══════════════════ ITEMS TABLE ═══════════════════ */}
        <table className="print-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: PRIMARY, color: '#fff' }}>
              {[
                { label: 'SL',          align: 'center' as const, width: '36px'  },
                { label: 'ITEM CODE',   align: 'left'   as const, width: '90px'  },
                { label: 'ITEM DETAILS',align: 'left'   as const               },
                { label: 'UNIT',        align: 'center' as const, width: '64px'  },
                { label: 'QTY',         align: 'center' as const, width: '48px'  },
                { label: 'RATE (৳)',    align: 'right'  as const, width: '88px'  },
                { label: 'DISC %',      align: 'center' as const, width: '58px'  },
                { label: 'AMOUNT (৳)', align: 'right'  as const, width: '96px'  },
              ].map((col) => (
                <th
                  key={col.label}
                  style={{
                    padding: '5px 8px',
                    textAlign: col.align,
                    fontSize: '10px',
                    fontWeight: '700',
                    letterSpacing: '0.4px',
                    width: col.width,
                    borderRight: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '20px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
                  No items
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr
                  key={idx}
                  style={{
                    background: idx % 2 === 0 ? '#fff' : '#f5f8ff',
                    borderBottom: '1px solid #e8edf6',
                  }}
                >
                  <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: '11px', color: '#555' }}>{idx + 1}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'left',   fontSize: '11px', color: '#555' }}>{item.product_sku || '—'}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'left',   fontSize: '11px', fontWeight: '500' }}>{item.product_name}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: '11px', color: '#555' }}>{item.unit_name || '—'}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: '11px' }}>{item.quantity}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right',  fontSize: '11px' }}>{Number(item.unit_price).toFixed(2)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: '11px', color: '#555' }}>
                    {(item.discount_percent || 0) > 0 ? `${item.discount_percent}%` : '—'}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>
                    {Number(item.subtotal).toFixed(2)}
                  </td>
                </tr>
              ))
            )}

            {/* Filler rows to fill the A4 page professionally */}
            {Array.from({ length: Math.max(0, 10 - items.length) }).map((_, idx) => (
              <tr
                key={`filler-${idx}`}
                style={{
                  background: (items.length + idx) % 2 === 0 ? '#fff' : '#f5f8ff',
                  borderBottom: '1px solid #e8edf6',
                }}
              >
                {Array.from({ length: 8 }).map((_, colIdx) => (
                  <td key={colIdx} style={{ padding: '3px 8px', fontSize: '11px', height: '20px' }}>&nbsp;</td>
                ))}
              </tr>
            ))}

          </tbody>
        </table>

        {/* ═══════════════════ QR + TOTALS ═══════════════════ */}
        <div className="print-totals-section" style={{ display: 'flex', borderTop: `2px solid ${PRIMARY}` }}>
          {/* QR */}
          <div
            style={{
              flex: '0 0 40%',
              padding: '8px 16px',
              borderRight: '1px solid #dde3ef',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontWeight: '800', fontSize: '10px', color: PRIMARY, marginBottom: '6px', letterSpacing: '1.5px' }}>
              SCAN TO VERIFY
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ border: `2px solid ${PRIMARY}`, padding: '3px', display: 'inline-block', background: '#fff' }}>
                <QRPlaceholder />
              </div>
              <div>
                <div style={{ fontSize: '10px', color: '#555', lineHeight: '1.5' }}>
                  Scan this QR code<br />to verify this invoice.
                </div>
                <div style={{ fontSize: '10px', fontWeight: '700', color: PRIMARY, marginTop: '3px' }}>
                  Invoice No: {docNumber}
                </div>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div style={{ flex: '0 0 60%', padding: '8px 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '2px 0', color: '#555' }}>Subtotal</td>
                  <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: '500' }}>{fmt(subtotal + discountTotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '2px 0', color: '#555' }}>Discount</td>
                  <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: '500' }}>{fmt(discountTotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '2px 0', color: '#555' }}>VAT (0%)</td>
                  <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: '500' }}>৳0.00</td>
                </tr>
                <tr>
                  <td style={{ padding: '2px 0 4px', color: '#555' }}>Shipping</td>
                  <td style={{ padding: '2px 0 4px', textAlign: 'right', fontWeight: '500' }}>৳0.00</td>
                </tr>
                <tr style={{ borderTop: `2px solid ${PRIMARY}` }}>
                  <td style={{ padding: '5px 0 3px', fontWeight: '800', color: PRIMARY, fontSize: '13px' }}>GRAND TOTAL</td>
                  <td style={{ padding: '5px 0 3px', textAlign: 'right', fontWeight: '800', color: PRIMARY, fontSize: '13px' }}>{fmt(totalAmount)}</td>
                </tr>
                {amountPaid > 0 && (
                  <tr>
                    <td style={{ padding: '2px 0', color: '#555' }}>Amount Paid</td>
                    <td style={{ padding: '2px 0', textAlign: 'right', color: GREEN, fontWeight: '600' }}>-{fmt(amountPaid)}</td>
                  </tr>
                )}
                <tr style={{ borderTop: '1px solid #dde3ef' }}>
                  <td style={{ padding: '5px 0 2px', fontWeight: '800', color: PRIMARY, fontSize: '14px' }}>BALANCE DUE</td>
                  <td style={{ padding: '5px 0 2px', textAlign: 'right', fontWeight: '800', color: PRIMARY, fontSize: '14px' }}>{fmt(balanceDue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══════════════════ TERMS / THANK YOU / SIGNATURES ═══════════════════ */}
        <div
          className="print-footer-section"
          style={{
            borderTop: `2px solid ${PRIMARY}`,
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'stretch',
          }}
        >
          {/* Terms & Conditions */}
          <div style={{ padding: '8px 14px' }}>
            <div
              style={{
                fontWeight: '800',
                fontSize: '10px',
                color: PRIMARY,
                letterSpacing: '1.5px',
                paddingBottom: '4px',
                borderBottom: `2px solid ${PRIMARY}`,
                marginBottom: '6px',
                display: 'inline-block',
              }}
            >
              TERMS &amp; CONDITIONS
            </div>
            <ol
              style={{
                fontSize: '10px',
                color: '#444',
                paddingLeft: '16px',
                margin: 0,
                lineHeight: '1.5',
                listStyleType: 'decimal',
              }}
            >
              <li style={{ paddingLeft: '4px', marginBottom: '1px' }}>Please check all items and quantities before leaving the store.</li>
              <li style={{ paddingLeft: '4px' }}>Any discrepancy must be reported within 24 hours.</li>
            </ol>
            {notes && (
              <div style={{ marginTop: '4px', fontSize: '10px', color: '#666' }}>
                <strong>Notes:</strong> {notes}
              </div>
            )}
          </div>

          {/* Thank You — center column */}
          <div
            style={{
              borderLeft: '1px solid #dde3ef',
              borderRight: '1px solid #dde3ef',
              padding: '8px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '180px',
            }}
          >
            {/* Script-style "Thank You!" */}
            <div
              style={{
                fontFamily: '"Brush Script MT", "Segoe Script", "Dancing Script", cursive',
                fontSize: '28px',
                color: PRIMARY,
                lineHeight: '1.1',
                whiteSpace: 'nowrap',
              }}
            >
              Thank You!
            </div>
            {/* Green underline */}
            <div
              style={{
                width: '80%',
                height: '2px',
                background: GREEN,
                borderRadius: '2px',
                margin: '4px 0 5px',
              }}
            />
            <div
              style={{
                fontSize: '9px',
                color: GREEN,
                letterSpacing: '2px',
                fontWeight: '700',
              }}
            >
              FOR YOUR BUSINESS
            </div>
          </div>

          {/* Signatures */}
          <div
            style={{
              padding: '8px 14px',
              display: 'grid',
              gridTemplateColumns: '1fr 1px 1fr',
              alignItems: 'end',
              gap: '0',
            }}
          >
            {/* Customer Signature */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 10px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ marginBottom: '4px' }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="12" cy="7" r="4" stroke="#aaa" strokeWidth="1.5" />
              </svg>
              <div style={{ width: '100%', borderTop: '1.5px solid #999', paddingTop: '3px', textAlign: 'center' }}>
                <span style={{ fontSize: '10px', color: '#555', fontWeight: '500' }}>Customer Signature</span>
              </div>
            </div>

            {/* Vertical divider between signatures */}
            <div style={{ background: '#dde3ef', alignSelf: 'stretch' }} />

            {/* Authorized Signature */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 10px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ marginBottom: '4px' }}>
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div style={{ width: '100%', borderTop: '1.5px solid #999', paddingTop: '3px', textAlign: 'center' }}>
                <span style={{ fontSize: '10px', color: '#555', fontWeight: '500' }}>Authorized Signature</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════ FOOTER BAR ═══════════════════ */}
        <div
          style={{
            background: PRIMARY,
            color: '#fff',
            display: 'flex',
            alignItems: 'stretch',
          }}
        >
          {/* Phone */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 18px', borderRight: '1px solid rgba(255,255,255,0.25)' }}>
            <div
              style={{
                width: '32px', height: '32px',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.37 11.5 19.79 19.79 0 0 1 1.25 2.85 2 2 0 0 1 3.22 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.3px' }}>{company.phone || '01842173617'}</div>
              <div style={{ fontSize: '9px', opacity: 0.75, marginTop: '1px' }}>For any queries</div>
            </div>
          </div>

          {/* Website */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 18px', borderRight: '1px solid rgba(255,255,255,0.25)', justifyContent: 'center' }}>
            <div
              style={{
                width: '32px', height: '32px',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.3px' }}>
                {company.website || 'www.sibuildingsolutions.com'}
              </div>
              <div style={{ fontSize: '9px', opacity: 0.75, marginTop: '1px' }}>Visit our website</div>
            </div>
          </div>

          {/* Computer-generated note */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 18px' }}>
            <div
              style={{
                width: '32px', height: '32px',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="14,2 14,8 20,8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="16" y1="13" x2="8" y2="13" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                <line x1="16" y1="17" x2="8" y2="17" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ fontSize: '10px', opacity: 0.9, lineHeight: '1.5' }}>
              This is a computer-generated document and does not require a signature.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
