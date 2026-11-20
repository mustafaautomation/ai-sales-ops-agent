import {
  databasePath,
  httpPorts,
  openDatabase,
  type DB,
  type Ports,
} from '@meridian/core'

export function deskDb(): DB {
  return openDatabase(databasePath())
}

export function deskPorts(): Ports {
  return httpPorts({
    emailBaseUrl: process.env.EMAIL_API_URL || 'http://127.0.0.1:4001',
    crmBaseUrl: process.env.CRM_API_URL || 'http://127.0.0.1:4002',
  })
}

export function demoEnabled(): boolean {
  return process.env.DEMO_MODE !== 'false'
}
