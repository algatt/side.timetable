import test from 'node:test'
import assert from 'node:assert/strict'
import {sortRows} from '../src/lib/tableSort.ts'
test('numeric columns sort as numbers, with unknowns last in both directions',()=>{
 const rows=[{room:'ICT-10',n:null},{room:'ICT-2',n:9},{room:'ICT-3',n:30},{room:'ICT-4',n:0},{room:'ICT-5',n:undefined},{room:'ICT-6',n:NaN}]
 assert.deepEqual(sortRows(rows,r=>r.n,'asc',r=>r.room).map(r=>r.room),['ICT-4','ICT-2','ICT-3','ICT-5','ICT-6','ICT-10'])
 assert.deepEqual(sortRows(rows,r=>r.n,'desc',r=>r.room).map(r=>r.room),['ICT-3','ICT-2','ICT-4','ICT-5','ICT-6','ICT-10'])
 assert.equal(rows[0].room,'ICT-10')
})
test('room identifiers use natural ordering and ties retain room order regardless of direction',()=>{
 const rows=[{room:'ICT-10',v:2},{room:'ICT-2',v:2},{room:'ICT-1',v:1}]
 assert.deepEqual(sortRows(rows,r=>r.room,'asc',r=>r.room).map(r=>r.room),['ICT-1','ICT-2','ICT-10'])
 assert.deepEqual(sortRows(rows,r=>r.v,'desc',r=>r.room).map(r=>r.room),['ICT-2','ICT-10','ICT-1'])
})
test('time strings order chronologically; blank text stays last',()=>{
 const rows=[{room:'A',time:'20:00'},{room:'B',time:'08:30'},{room:'C',time:'10:00'},{room:'D',time:''}]
 assert.deepEqual(sortRows(rows,r=>r.time,'asc',r=>r.room).map(r=>r.room),['B','C','A','D'])
 assert.deepEqual(sortRows(rows,r=>r.time,'desc',r=>r.room).map(r=>r.room),['A','C','B','D'])
})
