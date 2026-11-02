# 18 — The isometric's information: View and Edit

The owner's request (2026-11-02): a complete View / Edit form for the isometric's
own information, in logical sections, over what the system already holds.

The «مشخصات» tab of the workspace (components/IsoInfo.jsx, lib/register/iso-info.mjs):

- **View** (default): five sections — شناسهٔ نقشه (drawing number, revision, sheet, unit),
  خط و کلاس (line number, piping class, class printed on the sheet, default NPS and
  schedule), شرایط طراحی و کاری (design / operating pressure and temperature),
  تست و بازرسی (test fluid and pressure, NDT, PWHT), عایق و رنگ — every value read-only,
  «نامعلوم» where nobody gave one. Beside them, read-only, what the register keeps of the
  run (status, drawing and revision saved, welds, who approved).
- **Edit**: the same values as fields (project pick lists where a column has one:
  piping class, size, schedule, test fluid, NDT, PWHT, paint, insulation). The page
  shows them as they are typed. «اعمال» closes Edit; «انصراف» restores every value as
  it was when Edit was opened (asks first when something changed); an approved
  register is View only.
- **Problems**: a missing drawing number or revision blocks «اعمال» (the register is
  keyed by them). Everything else only warns, nothing is corrected: a sheet not written
  N/M or past the last, a value with no number, an operating value above the design
  value, a test pressure below the design pressure, a default size that is not a pipe size.

**No field was added.** The fields the request listed that the system does not hold
(project, area, service, contractor, dates, remarks) were not invented as columns:
the project is the page's own, the dates and status belong to the register and are shown
there. Adding a column is a schema change and is a separate decision. The line number
is one value kept in two stores (the sheet's meta and the line list): the form writes both.

Tests: db/test/iso-info.mjs; each guard turned off, its test fails.
