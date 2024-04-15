import { FastifyRequest } from 'fastify'
import { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { ValidateFunction } from 'ajv'
import Ajv from 'ajv'
import { Storage } from '../../../storage'
import { default as CreateBucket } from './commands/create-bucket'
import { default as ListBucket } from './commands/list-buckets'
import { default as ListObjects } from './commands/list-objects'
import { default as GetObject } from './commands/get-object'
import { default as CompleteMultipartUpload } from './commands/complete-multipart-upload'
import { default as DeleteBucket } from './commands/delete-bucket'
import { default as CreateMultipartUpload } from './commands/create-multipart-upload'
import { default as UploadPart } from './commands/upload-part'
import { default as HeadObject } from './commands/head-object'
import { default as DeleteObject } from './commands/delete-object'
import { default as AbortMultiPartUpload } from './commands/abort-multipart-upload'
import { default as GetBucket } from './commands/get-bucket'
import { default as HeadBucket } from './commands/head-bucket'
import { default as CopyObject } from './commands/copy-object'
import { default as ListMultipartUploads } from './commands/list-multipart-uploads'
import { default as ListParts } from './commands/list-parts'
import { default as UploadPartCopy } from './commands/upload-part-copy'
import { JTDDataType } from 'ajv/dist/jtd'

export type Context = { storage: Storage; tenantId: string; owner?: string; req: FastifyRequest }
export type S3Router = Router<Context>

const s3Commands = [
  UploadPartCopy,
  CopyObject,
  DeleteBucket,
  HeadObject,
  CreateBucket,
  CompleteMultipartUpload,
  CreateMultipartUpload,
  UploadPart,
  AbortMultiPartUpload,
  ListMultipartUploads,
  DeleteObject,
  GetBucket,
  HeadBucket,
  ListBucket,
  ListParts,
  GetObject,
  ListObjects,
]

export function getRouter() {
  const router = new Router<Context>()
  s3Commands.forEach((command) => command(router))
  return router
}

export type HTTPMethod = 'get' | 'put' | 'post' | 'head' | 'delete' | 'patch'

export type Schema<
  Q extends JSONSchema = JSONSchema,
  H extends JSONSchema = JSONSchema,
  P extends JSONSchema = JSONSchema,
  B extends JSONSchema = JSONSchema
> = {
  summary?: string
  Querystring?: Q
  Headers?: H
  Params?: P
  Body?: B
}

type ResponseType = {
  statusCode?: number
  headers?: Record<string, string>
  responseBody?: unknown
}

export type RequestInput<
  S extends Schema,
  A extends {
    [key in keyof S]: S[key] extends JSONSchema ? FromSchema<S[key]> : undefined
  } = {
    [key in keyof S]: S[key] extends JSONSchema ? FromSchema<S[key]> : undefined
  }
> = {
  Querystring: A['Querystring']
  Headers: A['Headers']
  Params: A['Params']
  Body: A['Body']
}

type Handler<Req extends Schema, Context = unknown> = (
  req: RequestInput<Req>,
  ctx: Context
) => Promise<ResponseType>

type Route<S extends Schema, Context> = {
  method: HTTPMethod
  path: string
  querystringMatches: { key: string; value: string }[]
  headersMatches: string[]
  handler?: Handler<S, Context>
  schema: S
  disableContentTypeParser?: boolean
  compiledSchema: () => ValidateFunction<JTDDataType<S>>
}

interface RouteOptions {
  disableContentTypeParser?: boolean
}

export class Router<Context = unknown, S extends Schema = Schema> {
  protected _routes: Map<string, Route<S, Context>[]> = new Map<string, Route<S, Context>[]>()

  protected ajv = new Ajv({
    coerceTypes: 'array',
    useDefaults: true,
    removeAdditional: true,
    uriResolver: require('fast-uri'),
    addUsedSchema: false,
    allErrors: false,
  })

  registerRoute<R extends S = S>(
    method: HTTPMethod,
    url: string,
    schema: R,
    handler: Handler<R, Context>,
    options?: { disableContentTypeParser?: boolean }
  ) {
    const { query, headers } = this.parseQueryString(url)
    const normalizedUrl = url.split('?')[0].split('|')[0]

    const existingPath = this._routes.get(normalizedUrl)
    const schemaToCompile: {
      Params?: JSONSchema
      Headers?: JSONSchema
      Querystring?: JSONSchema
      Body?: JSONSchema
    } = {}

    if (schema.Params) {
      schemaToCompile.Params = schema.Params
    }
    if (schema.Body) {
      schemaToCompile.Body
    }
    if (schema.Headers) {
      schemaToCompile.Headers = schema.Headers
    }

    if (schema.Querystring) {
      schemaToCompile.Querystring = schema.Querystring
    }

    this.ajv.addSchema(
      {
        type: 'object',
        properties: schemaToCompile,
      },
      method + url
    )

    const newRoute: Route<R, Context> = {
      method: method as HTTPMethod,
      path: normalizedUrl,
      querystringMatches: query,
      headersMatches: headers,
      schema: schema,
      compiledSchema: () => this.ajv.getSchema(method + url) as ValidateFunction<JTDDataType<R>>,
      handler: handler as Handler<R, Context>,
      disableContentTypeParser: options?.disableContentTypeParser,
    } as const

    if (!existingPath) {
      this._routes.set(normalizedUrl, [newRoute as unknown as Route<S, Context>])
      return
    }

    existingPath.push(newRoute as unknown as Route<S, Context>)
    this._routes.set(normalizedUrl, existingPath)
  }

  get<R extends S>(url: string, schema: R, handler: Handler<R, Context>, options?: RouteOptions) {
    this.registerRoute('get', url, schema, handler as any, options)
  }

  post<R extends S = S>(
    url: string,
    schema: R,
    handler: Handler<R, Context>,
    options?: RouteOptions
  ) {
    this.registerRoute('post', url, schema, handler as any, options)
  }

  put<R extends S = S>(
    url: string,
    schema: R,
    handler: Handler<R, Context>,
    options?: RouteOptions
  ) {
    this.registerRoute('put', url, schema, handler as any, options)
  }

  delete<R extends S = S>(
    url: string,
    schema: R,
    handler: Handler<R, Context>,
    options?: RouteOptions
  ) {
    this.registerRoute('delete', url, schema, handler as any, options)
  }

  head<R extends S = S>(
    url: string,
    schema: R,
    handler: Handler<R, Context>,
    options?: RouteOptions
  ) {
    this.registerRoute('head', url, schema, handler as any, options)
  }

  parseQueryMatch(query: string) {
    const [key, value] = query.split('=')
    return { key, value }
  }

  parseQueryString(queryString: string) {
    const queries = queryString.replace(/\|.*/, '').split('?')[1]?.split('&') || []
    const headers = queryString.split('|').splice(1)

    if (queries.length === 0) {
      return { query: [{ key: '*', value: '*' }], headers: headers }
    }
    return { query: queries.map(this.parseQueryMatch), headers: headers }
  }

  routes() {
    return this._routes
  }

  matchRoute(
    route: Route<S, Context>,
    match: { query: Record<string, string>; headers: Record<string, string> }
  ) {
    if ((route.headersMatches?.length || 0) > 0) {
      return (
        this.matchHeaders(route.headersMatches, match.headers) &&
        this.matchQueryString(route.querystringMatches, match.query)
      )
    }

    return this.matchQueryString(route.querystringMatches, match.query)
  }

  protected matchHeaders(headers: string[], received?: Record<string, string>) {
    if (!received) {
      return headers.length === 0
    }

    return headers.every((header) => received[header] !== undefined)
  }

  protected matchQueryString(
    matches: { key: string; value: string }[],
    received?: Record<string, string>
  ) {
    const keys = Object.keys(received || {})
    if (keys.length === 0 || !received) {
      return matches.find((m) => m.key === '*')
    }

    const foundMatches = matches.every((m) => {
      const key = Object.keys(received).find((k) => k === m.key)
      return (
        (m.key === key && m.value !== undefined && m.value === received[m.key]) ||
        (m.key === key && m.value === undefined)
      )
    })

    if (foundMatches) {
      return true
    }

    if (!foundMatches && matches.find((m) => m.key === '*')) {
      return true
    }
    return false
  }
}
