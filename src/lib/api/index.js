import {
	REPORT_CATEGORIES,
	ZONES,
	STATUS_FLOW,
	PRIORITY_LEVELS,
	VOLUME_LEVELS,
	TASK_STATUS_FLOW,
	SEVERITY_BY_VOLUME,
	PRIORITY_BY_SEVERITY,
	generateReferenceCode,
	generateTaskCode,
} from './constants.js'
import { createApiClient } from './client.js'

export const api = createApiClient()

export {
	REPORT_CATEGORIES,
	ZONES,
	STATUS_FLOW,
	PRIORITY_LEVELS,
	VOLUME_LEVELS,
	TASK_STATUS_FLOW,
	SEVERITY_BY_VOLUME,
	PRIORITY_BY_SEVERITY,
	generateReferenceCode,
	generateTaskCode,
}
