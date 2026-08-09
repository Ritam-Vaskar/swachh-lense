import twilio from 'twilio'
import nodemailer from 'nodemailer'
import { getPool } from '../models/database.js'

// --- Initialize Twilio (SMS) ---
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null
const twilioPhone = process.env.TWILIO_PHONE_NUMBER || ''

// --- Initialize Nodemailer (Email) ---
const mailTransporter = (process.env.SMTP_HOST && process.env.SMTP_USER)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null
const mailFrom = process.env.SMTP_FROM || 'no-reply@swachhlens.local'


export async function runNotificationAgent(reportId, taskId) {
  const pool = getPool()

  try {
    // 1. Fetch data
    const { rows: reportRows } = await pool.query('SELECT * FROM swachhlens_reports WHERE id = $1', [reportId])
    const report = reportRows[0]

    const { rows: taskRows } = await pool.query('SELECT * FROM swachhlens_tasks WHERE id = $1', [taskId])
    const task = taskRows[0]

    if (!report || !task) {
      console.error(`[NotificationAgent] Missing report or task for Notification (report: ${reportId}, task: ${taskId})`)
      return
    }

    const { rows: workerRows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [task.worker_id])
    const worker = workerRows[0]

    console.log(`[NotificationAgent] Dispatching notifications for Report ${report.reference_code}`)

    // 2. Notify Worker
    if (worker && worker.phone) {
      const workerMsg = `SWACHHLENS DISPATCH: New task assigned (${report.priority} priority).
Category: ${report.category}
Location: ${report.location}
ETA Required: ${task.eta}
Vehicle/Tools: ${task.vehicle}`

      await sendSMS(worker.phone, workerMsg, 'Worker')
    }

    // 3. Notify Citizen (if they provided a phone number)
    if (report.citizen_phone) {
      const citizenMsg = `SwachhLens Update: Your report (${report.reference_code}) has been verified. 
A crew is on the way (ETA: ${task.eta}). Thank you for keeping our city clean!`

      await sendSMS(report.citizen_phone, citizenMsg, 'Citizen')
    }

    // Optional: If you extend schema to include citizen_email, you can trigger email here:
    // if (report.citizen_email) {
    //   await sendEmail(report.citizen_email, 'SwachhLens Issue Update', `Your report...`)
    // }

  } catch (err) {
    console.error('[NotificationAgent] Encountered error while running:', err)
  }
}

// --- Helper Functions ---

async function sendSMS(toPhoneNumber, messageBody, recipientType) {
  if (!twilioClient) {
    console.log(`[NotificationAgent] SKIPPED SMS to ${recipientType} (${toPhoneNumber}): Twilio ENVs missing.`)
    console.log(`[NotificationAgent] > "SMS Content: ${messageBody.replace(/\n/g, ' ')}"`)
    return
  }

  try {
    const msg = await twilioClient.messages.create({
      body: messageBody,
      from: twilioPhone,
      to: toPhoneNumber
    })
    console.log(`[NotificationAgent] Sent SMS to ${recipientType} (${toPhoneNumber}). SID: ${msg.sid}`)
  } catch (err) {
    console.error(`[NotificationAgent] Failed to send SMS to ${toPhoneNumber}:`, err.message)
  }
}

async function sendEmail(toEmail, subject, htmlBody) {
  if (!mailTransporter) {
    console.log(`[NotificationAgent] SKIPPED Email to ${toEmail}: SMTP ENVs missing.`)
    return
  }

  try {
    const info = await mailTransporter.sendMail({
      from: mailFrom,
      to: toEmail,
      subject,
      html: htmlBody
    })
    console.log(`[NotificationAgent] Sent Email to ${toEmail}. ID: ${info.messageId}`)
  } catch (err) {
    console.error(`[NotificationAgent] Failed to send Email to ${toEmail}:`, err.message)
  }
}
