CREATE FUNCTION prevent_role_code_change() RETURNS trigger AS $$
BEGIN
    IF NEW."code" IS DISTINCT FROM OLD."code" THEN
        RAISE EXCEPTION 'Role.code is immutable'
            USING ERRCODE = '23514', CONSTRAINT = 'Role_code_immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Role_code_immutable"
BEFORE UPDATE OF "code" ON "Role"
FOR EACH ROW EXECUTE FUNCTION prevent_role_code_change();
