"""Unit tests for the derived-district passes in scripts/build.py.

These run without the full dataset: both inference helpers take a plain list of
campus dicts, so a reproduction is a handful of literal records rather than a
fixture carved out of the real data.

Run:  python tests/test_build.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))

from build import (  # noqa: E402
    inherit_exact_address_districts,
    infer_exact_address_districts,
    pinned_district_ids,
)

# Deliberately an address that *does* contain a legal district name, so both
# inference passes would fire on it.  An address that triggers neither would
# make the assertions below pass even with the bug present.
ADDRESS = '浙江省杭州市钱塘区下沙高教园区学林街16号'
REGIONS = {'zhihang': {'p': '浙江省', 'c': '杭州市', 'd': '钱塘区'}}


def _campus(cid, d=None):
    """A campus at ADDRESS.  Omit ``d`` entirely by leaving it as None."""
    record = {'id': cid, 'p': '浙江省', 'c': '杭州市', 'address': ADDRESS}
    if d is not None:
        record['d'] = d
    return record


class ExplicitEmptyDistrictOverride(unittest.TestCase):
    """`d: ""` in an override is a rollback decision, not a missing value.

    A record rolled back to city level has the same shape as one that never had
    a district, so both inference passes read it as "unknown" and handed it a
    district from a donor at the same address.  The rollback then never reached
    the built dataset: the record kept a district it was explicitly cleared of,
    and the gap count came out one short.
    """

    def test_empty_override_is_not_refilled_by_address_inheritance(self):
        donor = _campus('DONOR', '钱塘区')
        rolled_back = _campus('ROLLED', '')
        pinned = pinned_district_ids({'ROLLED': {'d': ''}}, [donor, rolled_back])

        inherit_exact_address_districts([donor, rolled_back], pinned)

        self.assertEqual(rolled_back.get('d'), '')
        self.assertNotIn('districtInferenceMethod', rolled_back)

    def test_empty_override_is_not_refilled_by_legal_name_inference(self):
        rolled_back = _campus('ROLLED', '')
        pinned = pinned_district_ids({'ROLLED': {'d': ''}}, [rolled_back])

        infer_exact_address_districts([rolled_back], REGIONS, pinned)

        self.assertEqual(rolled_back.get('d'), '')
        self.assertNotIn('districtInferenceMethod', rolled_back)

    def test_absent_district_is_still_inherited(self):
        """The pin is opt-in: omitting the key must keep working as before."""
        donor = _campus('DONOR', '钱塘区')
        unknown = _campus('UNKNOWN')  # no 'd' key at all
        pinned = pinned_district_ids({'ROLLED': {'d': ''}}, [donor, unknown])

        inherit_exact_address_districts([donor, unknown], pinned)

        self.assertEqual(unknown['d'], '钱塘区')
        self.assertEqual(unknown['districtInheritedFrom'], ['DONOR'])

    def test_absent_district_is_still_legal_name_inferred(self):
        unknown = _campus('UNKNOWN')

        infer_exact_address_districts([unknown], REGIONS, set())

        self.assertEqual(unknown['d'], '钱塘区')
        self.assertEqual(unknown['districtSourceKind'], 'address-exact')


class PinnedDistrictIds(unittest.TestCase):
    def test_only_explicitly_empty_overrides_are_pinned(self):
        campuses = [_campus('A'), _campus('B'), _campus('C')]
        overrides = {
            'A': {'d': '', 'districtEvidence': 'rolled back'},
            'B': {'d': '钱塘区'},
            'C': {'districtEvidence': 'no d key'},
        }
        self.assertEqual(pinned_district_ids(overrides, campuses), {'A'})

    def test_records_without_overrides_are_not_pinned(self):
        self.assertEqual(pinned_district_ids({}, [_campus('A')]), set())


if __name__ == '__main__':
    unittest.main(verbosity=2)
