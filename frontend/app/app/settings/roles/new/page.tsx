import { redirect } from "next/navigation"

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams
  redirect(`/app/users/roles/new${from ? `?from=${from}` : ""}`)
}
