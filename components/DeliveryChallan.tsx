'use client';

import { formatDate } from '@/lib/format';

export interface ChallanItem {
  product_name: string;
  product_sku?: string;
  quantity: number;
  delivered_quantity?: number;
  unit_name?: string;
}

export interface DeliveryChallanProps {
  challanNumber: string;
  deliveryDate?: string;
  invoiceNumber?: string;
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
    phone?: string;
    address?: string;
    city?: string;
  };
  items: ChallanItem[];
  vehicleNumber?: string;
  driverName?: string;
  notes?: string;
}

const PRIMARY = '#1e3a6e';
const GREEN = '#4caf50';
const LOGO_SRC = '/Whats-App-Image-2026-07-09-at-15-57-58.jpg';

export default function DeliveryChallan({
  challanNumber,
  deliveryDate,
  invoiceNumber,
  company,
  customer,
  items,
  vehicleNumber,
  driverName,
  notes,
}: DeliveryChallanProps) {
  const totalQty = items.reduce(
    (s, i) => s + Math.abs(i.delivered_quantity ?? i.quantity),
    0
  );

  const logoSrc = company.logo_url || LOGO_SRC;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 8mm; }
          body * { visibility: hidden !important; }
          .print-document, .print-document * { visibility: visible !important; }
          .print-document {
            position: static !important;
            top: auto !important; left: auto !important;
            width: 100% !important; max-width: 100% !important;
            margin: 0 !important;
            border: none !important; border-radius: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
          .print-items-table { page-break-inside: auto; }
          .print-items-table tr { page-break-inside: avoid; break-inside: avoid; page-break-after: auto; }
          .print-footer-section { page-break-inside: avoid; break-inside: avoid; }
          .print-header-logo { height: 52px !important; }
          .print-header-section { padding: 8px 16px !important; }
          .print-items-table td, .print-items-table th { padding-top: 3px !important; padding-bottom: 3px !important; }
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
          {/* Logo */}
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

          {/* Right: Doc title + delivery badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
            <div
              style={{
                fontSize: '28px',
                fontWeight: '900',
                color: PRIMARY,
                letterSpacing: '2px',
                lineHeight: '1.1',
                textAlign: 'right',
              }}
            >
              DELIVERY<br />CHALLAN
            </div>
            <div
              style={{
                background: GREEN,
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '6px',
                fontWeight: '700',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="1" y="3" width="15" height="13" rx="1" stroke="#fff" strokeWidth="2" />
                <path d="M16 8h3l3 3v5h-6V8z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="5.5" cy="18.5" r="2.5" stroke="#fff" strokeWidth="2" />
                <circle cx="18.5" cy="18.5" r="2.5" stroke="#fff" strokeWidth="2" />
              </svg>
              DELIVERY
            </div>
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
          {/* Deliver To */}
          <div style={{ padding: '14px 18px', borderRight: '1px solid #dde3ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
              <div
                style={{
                  width: '24px', height: '24px',
                  background: PRIMARY, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="7" r="4" stroke="#fff" strokeWidth="2" />
                </svg>
              </div>
              <span style={{ fontWeight: '800', fontSize: '11px', color: PRIMARY, letterSpacing: '1.5px' }}>DELIVER TO</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                <tr>
                  <td style={{ color: '#666', paddingBottom: '5px', paddingRight: '6px', whiteSpace: 'nowrap' }}>Customer</td>
                  <td style={{ color: '#666', paddingBottom: '5px', paddingRight: '4px' }}>:</td>
                  <td style={{ fontWeight: '700', paddingBottom: '5px' }}>{customer.name}</td>
                </tr>
                {customer.phone && (
                  <tr>
                    <td style={{ color: '#666', paddingBottom: '5px', paddingRight: '6px' }}>Phone</td>
                    <td style={{ color: '#666', paddingBottom: '5px', paddingRight: '4px' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '5px' }}>{customer.phone}</td>
                  </tr>
                )}
                {customer.address && (
                  <tr>
                    <td style={{ color: '#666', paddingBottom: '5px', paddingRight: '6px', verticalAlign: 'top' }}>Address</td>
                    <td style={{ color: '#666', paddingBottom: '5px', paddingRight: '4px', verticalAlign: 'top' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '5px' }}>
                      {customer.address}{customer.city ? `, ${customer.city}` : ''}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Company Info */}
          <div style={{ padding: '14px 18px', borderRight: '1px solid #dde3ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
              <div
                style={{
                  width: '24px', height: '24px',
                  background: PRIMARY, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="#fff" strokeWidth="2" />
                  <circle cx="12" cy="10" r="3" stroke="#fff" strokeWidth="2" />
                </svg>
              </div>
              <span style={{ fontWeight: '800', fontSize: '11px', color: PRIMARY, letterSpacing: '1px' }}>
                {company.name.toUpperCase()}
              </span>
            </div>
            {company.address && (
              <div style={{ fontSize: '12px', color: '#444', lineHeight: '1.6', marginBottom: '8px' }}>
                {company.address}
              </div>
            )}
            {company.phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginBottom: '4px', color: '#333' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.37 11.5 19.79 19.79 0 0 1 1.25 2.85 2 2 0 0 1 3.22 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z" stroke={PRIMARY} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span style={{ fontWeight: '600' }}>{company.phone}</span>
              </div>
            )}
            {company.email && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#333' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="20" height="16" rx="2" stroke={PRIMARY} strokeWidth="2" />
                  <path d="M2 7l10 7 10-7" stroke={PRIMARY} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span style={{ fontWeight: '600' }}>{company.email}</span>
              </div>
            )}
          </div>

          {/* Challan Details */}
          <div style={{ padding: '14px 18px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                <tr>
                  <td style={{ color: '#555', paddingBottom: '7px', whiteSpace: 'nowrap' }}>Challan No.</td>
                  <td style={{ color: '#555', paddingBottom: '7px', textAlign: 'center', width: '16px' }}>:</td>
                  <td style={{ fontWeight: '800', color: PRIMARY, paddingBottom: '7px', textAlign: 'right' }}>{challanNumber}</td>
                </tr>
                {deliveryDate && (
                  <tr>
                    <td style={{ color: '#555', paddingBottom: '7px' }}>Delivery Date</td>
                    <td style={{ color: '#555', paddingBottom: '7px', textAlign: 'center' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '7px', textAlign: 'right' }}>{formatDate(deliveryDate)}</td>
                  </tr>
                )}
                {invoiceNumber && (
                  <tr>
                    <td style={{ color: '#555', paddingBottom: '7px', whiteSpace: 'nowrap' }}>Invoice No.</td>
                    <td style={{ color: '#555', paddingBottom: '7px', textAlign: 'center' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '7px', textAlign: 'right' }}>{invoiceNumber}</td>
                  </tr>
                )}
                {vehicleNumber && (
                  <tr>
                    <td style={{ color: '#555', paddingBottom: '7px', whiteSpace: 'nowrap' }}>Vehicle No.</td>
                    <td style={{ color: '#555', paddingBottom: '7px', textAlign: 'center' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '7px', textAlign: 'right' }}>{vehicleNumber}</td>
                  </tr>
                )}
                {driverName && (
                  <tr>
                    <td style={{ color: '#555', paddingBottom: '7px' }}>Driver</td>
                    <td style={{ color: '#555', paddingBottom: '7px', textAlign: 'center' }}>:</td>
                    <td style={{ fontWeight: '600', paddingBottom: '7px', textAlign: 'right' }}>{driverName}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══════════════════ ITEMS TABLE ═══════════════════ */}
        <table className="print-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: PRIMARY, color: '#fff' }}>
              {[
                { label: 'SL',           align: 'center' as const, width: '44px'  },
                { label: 'ITEM CODE',    align: 'left'   as const, width: '110px' },
                { label: 'ITEM NAME',    align: 'left'   as const               },
                { label: 'UNIT',         align: 'center' as const, width: '72px'  },
                { label: 'DELIVERED QTY', align: 'center' as const, width: '110px' },
              ].map((col) => (
                <th
                  key={col.label}
                  style={{
                    padding: '10px 10px',
                    textAlign: col.align,
                    fontSize: '11px',
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
                <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
                  No items
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const qty = item.delivered_quantity ?? item.quantity;
                return (
                  <tr
                    key={idx}
                    style={{
                      background: idx % 2 === 0 ? '#fff' : '#f5f8ff',
                      borderBottom: '1px solid #e8edf6',
                    }}
                  >
                    <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: '12px', color: '#555' }}>{idx + 1}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'left',   fontSize: '12px', color: '#555' }}>{item.product_sku || '—'}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'left',   fontSize: '12px', fontWeight: '500' }}>{item.product_name}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: '12px', color: '#555' }}>{item.unit_name || '—'}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>{qty}</td>
                  </tr>
                );
              })
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
                {Array.from({ length: 5 }).map((_, colIdx) => (
                  <td key={colIdx} style={{ padding: '9px 10px', fontSize: '12px', height: '24px' }}>&nbsp;</td>
                ))}
              </tr>
            ))}

            {/* Total row */}
            <tr style={{ background: PRIMARY }}>
              <td colSpan={4} style={{ padding: '9px 10px', textAlign: 'right', fontSize: '12px', fontWeight: '700', color: '#fff', letterSpacing: '0.5px' }}>
                TOTAL ITEMS DELIVERED
              </td>
              <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: '13px', fontWeight: '800', color: '#fff' }}>
                {totalQty}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ═══════════════════ REMARKS ═══════════════════ */}
        {notes && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #dde3ef',
              background: '#f8faff',
            }}
          >
            <span style={{ fontWeight: '700', fontSize: '11px', color: PRIMARY, letterSpacing: '1px', marginRight: '8px' }}>
              REMARKS:
            </span>
            <span style={{ fontSize: '12px', color: '#444' }}>{notes}</span>
          </div>
        )}

        {/* ═══════════════════ SIGNATURES ═══════════════════ */}
        <div
          className="print-footer-section"
          style={{
            borderTop: `2px solid ${PRIMARY}`,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: '0',
          }}
        >
          {[
            { label: 'Receiver',
              icon: (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="12" cy="7" r="4" stroke="#aaa" strokeWidth="1.5" />
                </svg>
              ),
            },
            { label: 'Store Officer',
              icon: (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round" />
                  <polyline points="9,22 9,12 15,12 15,22" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              ),
            },
            { label: 'Security Officer',
              icon: (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              ),
            },
            { label: 'Driver',
              icon: (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <rect x="1" y="3" width="15" height="13" rx="1" stroke="#aaa" strokeWidth="1.5" />
                  <path d="M16 8h3l3 3v5h-6V8z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="5.5" cy="18.5" r="2.5" stroke="#aaa" strokeWidth="1.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" stroke="#aaa" strokeWidth="1.5" />
                </svg>
              ),
            },
          ].map((sig, idx) => (
            <div
              key={sig.label}
              style={{
                padding: '16px 14px 14px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                borderRight: idx < 3 ? '1px solid #dde3ef' : undefined,
              }}
            >
              <div style={{ marginBottom: '8px', opacity: 0.5 }}>{sig.icon}</div>
              <div style={{ width: '100%', height: '32px' }} />
              <div style={{ width: '100%', borderTop: '1.5px solid #999', paddingTop: '5px', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#555', fontWeight: '500' }}>{sig.label}</span>
              </div>
            </div>
          ))}
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderRight: '1px solid rgba(255,255,255,0.25)' }}>
            <div
              style={{
                width: '38px', height: '38px',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.37 11.5 19.79 19.79 0 0 1 1.25 2.85 2 2 0 0 1 3.22 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: '700' }}>{company.phone || '01842173617'}</div>
              <div style={{ fontSize: '10px', opacity: 0.75, marginTop: '1px' }}>For any queries</div>
            </div>
          </div>

          {/* Website */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderRight: '1px solid rgba(255,255,255,0.25)', justifyContent: 'center' }}>
            <div
              style={{
                width: '38px', height: '38px',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: '700' }}>
                {company.website || 'www.sibuildingsolutions.com'}
              </div>
              <div style={{ fontSize: '10px', opacity: 0.75, marginTop: '1px' }}>Visit our website</div>
            </div>
          </div>

          {/* Computer-generated note */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px' }}>
            <div
              style={{
                width: '38px', height: '38px',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="14,2 14,8 20,8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="16" y1="13" x2="8" y2="13" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                <line x1="16" y1="17" x2="8" y2="17" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.9, lineHeight: '1.6' }}>
              This is a computer-generated document and does not require a signature.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
