import type { APIEvent } from '@solidjs/start/server'
import dgram from 'node:dgram'
import { encodePacket, type OscArg, type OscMessage } from '@/lib/osc/encode'

interface Payload {
  host?: string
  port?: number
  bundle?: boolean
  messages?: { address: string; args?: { type: 'f' | 'i' | 's'; value: number | string }[] }[]
}

function coerce(m: NonNullable<Payload['messages']>[number]): OscMessage {
  const args: OscArg[] = (m.args ?? []).map((a) =>
    a.type === 'i'
      ? { type: 'i' as const, value: Number(a.value) }
      : a.type === 's'
        ? { type: 's' as const, value: String(a.value) }
        : { type: 'f' as const, value: Number(a.value) }
  )
  return { address: String(m.address), args }
}

export async function POST(event: APIEvent): Promise<Response> {
  let body: Payload
  try {
    body = (await event.request.json()) as Payload
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const host = body.host || '127.0.0.1'
  const port = Number(body.port) || 8101
  const messages = (body.messages ?? []).slice(0, 128).map(coerce)
  if (messages.length === 0) return Response.json({ sent: 0 })

  const packets = encodePacket(messages, body.bundle !== false)
  const socket = dgram.createSocket('udp4')
  try {
    for (const p of packets) await sendOne(socket, p, host, port)
    return Response.json({ sent: packets.length, messages: messages.length })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'send failed' },
      { status: 502 }
    )
  } finally {
    socket.close()
  }
}

function sendOne(socket: dgram.Socket, data: Uint8Array, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    socket.send(data, port, host, (err) => (err ? reject(err) : resolve()))
  })
}
