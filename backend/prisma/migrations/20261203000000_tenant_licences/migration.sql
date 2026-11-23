-- The licence each business runs on, as issued and signed by the Console (or loaded from a
-- licence file on a self-hosted install). Entitlements are read from here.
CREATE TABLE public.tenant_licences (
    tenant_id uuid NOT NULL,
    token text NOT NULL,
    seq integer NOT NULL,
    status text NOT NULL,
    plan_key text NOT NULL,
    payload jsonb NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    source text DEFAULT 'console'::text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_licences_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT tenant_licences_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT tenant_licences_source_check CHECK (source = ANY (ARRAY['console'::text, 'file'::text]))
);
ALTER TABLE public.tenant_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.tenant_licences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.tenant_licences USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_licences TO app_user;
