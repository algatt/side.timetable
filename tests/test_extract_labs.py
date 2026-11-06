from pathlib import Path
import tempfile
import unittest

from backend.extract_labs import DEFAULT_LABS, checked, extract_labs, number


class LabValueTests(unittest.TestCase):
    def test_blank_cells_remain_unknown(self):
        self.assertIsNone(checked(''))
        self.assertIsNone(number(None))
        self.assertTrue(checked('\uf0fc'))
        self.assertEqual(number('30'), 30)
        with self.assertRaises(ValueError):
            checked('?')
        with self.assertRaises(ValueError):
            number('x30')


@unittest.skipUnless(DEFAULT_LABS.exists(), 'The supplied lab inventory PDF is not present.')
class SuppliedLabPdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.folder.cleanup)
        cls.inventory = extract_labs(output=Path(cls.folder.name) / 'labs.json')
        cls.rooms = {lab['room']: lab for lab in cls.inventory['rooms']}

    def test_all_rooms_and_legend_categories(self):
        self.assertEqual(len(self.rooms), 55)
        self.assertEqual(self.inventory['category_counts'], {'computer_lab': 40, 'other': 10, 'classroom': 5})
        self.assertEqual(self.rooms['ICT-047']['kind'], 'classroom')
        self.assertEqual(self.rooms['ICT-126']['kind'], 'other')
        self.assertEqual(self.rooms['ICT-003']['kind'], 'computer_lab')

    def test_columns_are_not_shifted_when_cells_are_blank(self):
        network = self.rooms['ICT-003']
        self.assertEqual((network['seating_capacity'], network['student_pcs'], network['os']), (31, 20, 'Ubuntu'))
        self.assertIsNone(network['smartboard'])
        self.assertTrue(network['tv_screen'])
        self.assertIsNone(network['projector'])
        hardware = self.rooms['ICT-126']
        self.assertEqual(hardware['seating_capacity'], 19)
        self.assertIsNone(hardware['student_pcs'])
        self.assertTrue(hardware['projector'])

    def test_specialized_equipment_does_not_invent_student_pc_counts(self):
        for room in ('ICT-300', 'ICT-337'):
            self.assertIsNone(self.rooms[room]['student_pcs'])
            self.assertIn('Raspberry Pi', self.rooms[room]['notes'])
        self.assertEqual(self.rooms['ICT-336']['student_pcs'], 20)
        self.assertEqual(self.rooms['ICT-109']['student_pcs'], 7)

    def test_page_references_and_source_fields_are_retained(self):
        self.assertEqual(self.rooms['ICT-B02']['source_page'], 1)
        self.assertEqual(self.rooms['ICT-302']['source_page'], 2)
        self.assertEqual(self.rooms['ICT-302']['os'], 'MAC OS')
        self.assertEqual(self.rooms['ICT-236']['seating_capacity'], 1)
        self.assertEqual(self.rooms['ICT-B02']['raw_cells']['Notes'], 'Includes ACCA software')


if __name__ == '__main__':
    unittest.main()
