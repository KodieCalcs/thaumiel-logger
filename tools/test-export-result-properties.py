import importlib.util,pathlib,struct,unittest
spec=importlib.util.spec_from_file_location('exporter',pathlib.Path(__file__).with_name('export-result-properties.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DecodeTests(unittest.TestCase):
    def row(self):
        raw=bytearray(48);struct.pack_into('<iQf',raw,4,-1,123,0.3);struct.pack_into('<i',raw,24,-1)
        key='Actor_Test';text=key.encode('utf-16le')
        return dict(entries60_hex=raw.hex(),entries60_capacity='2',entries60_bytes='48',keys60=f'0:{len(key)}:{len(text)}:{text.hex()}|')
    def test_active_and_inactive(self):
        values,cut=module.decode_properties(self.row());self.assertAlmostEqual(values['Actor_Test'],0.3);self.assertFalse(cut)
    def test_missing_key_refused(self):
        r=self.row();r['keys60']=''
        with self.assertRaises(ValueError):module.decode_properties(r)
    def test_partial_array_refused(self):
        r=self.row();r['entries60_bytes']='47'
        with self.assertRaises(ValueError):module.decode_properties(r)
    def test_truncated_key_refused(self):
        r=self.row();r['keys60']=r['keys60'].replace('0:10:','0:200:')
        with self.assertRaises(ValueError):module.decode_properties(r)
    def test_duplicate_slot_refused(self):
        r=self.row();r['keys60']*=2
        with self.assertRaises(ValueError):module.decode_properties(r)
if __name__=='__main__':unittest.main()
