import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLINICAL_METRIC_GLOSSARY,
  getClinicalMetricCopy,
  type ClinicalMetricTermId,
} from '../src/presentation/shared/glossary/clinicalMetricGlossary.ts';

const EXPECTED_TERM_IDS: readonly ClinicalMetricTermId[] = [
  'MAD',
  'RMSE',
  'MAD_RMSE',
  'DTW',
  'GLOBAL_ACCURACY',
  'BCEA',
  'SACCADIC_GAIN',
  'SACCADIC_LATENCY',
  'FOVEAL_FIXATION',
  'TRIAL_SUCCESS_OMISSIONS',
  'MEDIAN_DURATION',
  'FALSE_FIXATIONS',
  'QUADRANT_COVERAGE',
  'INPUT_ORIGIN',
  'SESSION_DURATION_SAMPLES',
  'CONFIDENCE_MEAN',
  'GAZE_PATH_DISTANCE',
  'HEATMAP',
  'GAZE_PLOT',
  'SEQUENCE_COMPLETENESS',
  'ANGULAR_ERROR',
  'PARAM_ECCENTRICITY',
  'PARAM_MIN_FIXATION',
  'PARAM_HEMIFIELD_BIAS',
  'PARAM_TARGET_SIZE',
  'PARAM_ISI_REST',
];

describe('ClinicalMetricGlossary', () => {
  it('exposes all 26 required terms with distinct non-empty patient & specialist copy', () => {
    assert.equal(Object.keys(CLINICAL_METRIC_GLOSSARY).length, 26);

    for (const termId of EXPECTED_TERM_IDS) {
      const entry = CLINICAL_METRIC_GLOSSARY[termId];
      assert.ok(entry, `Missing glossary entry: ${termId}`);
      assert.equal(entry.id, termId);
      assert.ok(entry.title.trim().length > 0, `Empty title for ${termId}`);

      for (const audience of ['patient', 'specialist'] as const) {
        const copy = getClinicalMetricCopy(termId, audience);
        assert.ok(copy.whatItIs.trim().length > 10, `${termId}.${audience}.whatItIs too short`);
        assert.ok(copy.whyItMatters.trim().length > 10, `${termId}.${audience}.whyItMatters too short`);
        assert.ok(copy.howToRead.trim().length > 10, `${termId}.${audience}.howToRead too short`);

        const combined = `${copy.whatItIs} ${copy.whyItMatters} ${copy.howToRead}`;
        assert.equal(
          /120\s*hz|60\s*fps/i.test(combined),
          false,
          `${termId}.${audience} must not contain misleading 120 Hz or 60 FPS claims`
        );
      }

      assert.notEqual(
        entry.patient.whatItIs.trim(),
        entry.specialist.whatItIs.trim(),
        `${termId} should differentiate patient vs specialist explanation`
      );
      assert.notEqual(
        entry.patient.whyItMatters.trim(),
        entry.specialist.whyItMatters.trim(),
        `${termId} should differentiate patient vs specialist purpose`
      );
    }
  });

  it('returns practical guidance for key post-therapy & clinical precision terms', () => {
    const keyTerms: ClinicalMetricTermId[] = [
      'MAD',
      'RMSE',
      'MAD_RMSE',
      'DTW',
      'BCEA',
      'SACCADIC_GAIN',
      'FOVEAL_FIXATION',
      'CONFIDENCE_MEAN',
      'PARAM_ECCENTRICITY',
    ];

    for (const id of keyTerms) {
      const patientCopy = getClinicalMetricCopy(id, 'patient');
      const specialistCopy = getClinicalMetricCopy(id, 'specialist');
      assert.ok(patientCopy.howToRead.length > 0);
      assert.ok(specialistCopy.howToRead.length > 0);
      assert.notEqual(patientCopy.howToRead, specialistCopy.howToRead);
    }
  });
});
