-- Deleting a performance guarantee or test entered by mistake
-- (lib/db/repos/removal.mjs).
--
-- 048 granted no DELETE on either table. A guarantee a result was judged
-- against still cannot go: performance_result.guarantee_id is ON DELETE
-- RESTRICT. A test can go only before it is signed — enforced here, not
-- only in the application — and its unsigned results go with it (they
-- cascade, and performance_result_fixed lets an unsigned test's results be
-- removed).

GRANT DELETE ON performance_guarantee, performance_test TO app_rw;

CREATE FUNCTION performance_test_signed_kept() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'performance test % is signed; it is never deleted', OLD.test_no USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER performance_test_signed_kept BEFORE DELETE ON performance_test
  FOR EACH ROW EXECUTE FUNCTION performance_test_signed_kept();
