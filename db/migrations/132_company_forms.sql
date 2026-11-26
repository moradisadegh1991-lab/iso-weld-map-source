ALTER TABLE report_type ADD COLUMN form_company_id uuid REFERENCES company(id) ON DELETE RESTRICT;
