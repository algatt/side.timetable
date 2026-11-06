import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maltaNow, currentTimePosition, liveRequest, findLiveRooms, occupiedMinutes, roomUsage, alternatives, diffTimetables } from '../src/lib/insights.ts'
import { recordHistory } from '../scripts/history.mjs'
const entry=(extra={})=>({id:'a',group:'G',subject_code:'CODE',subject_name:'Subject',weekday:'Friday',start:'09:00',end:'10:00',rooms:['ICT-1'],...extra})
const data=(entries=[])=>({rooms:['ICT-1','ICT-2','IBMC-1'],entries,schedule_coverage:{weekdays:['Monday','Tuesday','Wednesday','Thursday','Friday'],start:'08:00',end:'20:00'}})
test('Malta clock observes winter and summer offsets',()=>{
 assert.deepEqual(maltaNow(new Date('2026-11-06T08:00:00Z')),{weekday:'Friday',time:'09:00'})
 assert.deepEqual(maltaNow(new Date('2026-07-03T08:00:00Z')),{weekday:'Friday',time:'10:00'})
})
test('live intervals reject weekends, before opening and crossing closing time',()=>{
 assert.equal(liveRequest(data(),30,new Date('2026-11-06T08:00:00Z')).end,'09:30')
 for(const date of ['2026-11-07T08:00:00Z','2026-11-06T06:00:00Z','2026-11-06T18:50:00Z'])assert.throws(()=>liveRequest(data(),30,new Date(date)))
 assert.equal(liveRequest(data(),30,new Date('2026-11-06T18:30:00Z')).end,'20:00')
})
test('usage unions, clips and separates day/room occupancy',()=>{
 const entries=[entry(),entry({id:'b',start:'09:30',end:'11:00'}),entry({id:'c',start:'09:00',end:'10:00'})]
 assert.equal(occupiedMinutes(entries,570,630),60)
 const rows=roomUsage(data(entries),['Friday'],'08:00','12:00')
 assert.equal(rows[0].occupied,120);assert.equal(rows[0].percent,50);assert.equal(rows.length,2)
 assert.equal(rows[1].occupied,0)
 assert.throws(()=>roomUsage(data(),['Sunday'],'08:00','12:00'))
})
test('alternative rooms require known capacity, equipment and OS and clear source label filter',()=>{
 const profile={room:'ICT-1',kind:'computer_lab',seating_capacity:20,student_pcs:18,os:'Windows 10 / Ubuntu',projector:true,smartboard:null,tv_screen:null,teacher_pc:true}
 const source=data([entry()]);source.rooms.push('ICT-3','ICT-4');source.lab_inventory={rooms:[profile,{...profile,room:'ICT-2'},{...profile,room:'ICT-3',student_pcs:null},{...profile,room:'ICT-4',os:'Windows 10'}]}
 const request={weekday:'Friday',start:'09:00',end:'10:00',building:'ICT',roomQuery:'1'}
 assert.deepEqual(alternatives(source,'ICT-1',request).rooms.map(r=>r.room),['ICT-2'])
 source.entries.push(entry({rooms:['ICT-2']}));assert.equal(alternatives(source,'ICT-1',request).rooms.length,0)
})
test('change comparison ignores PDF IDs/pages and room ordering, and tracks moves',()=>{
 const before=entry({rooms:['ICT-1','ICT-2']})
 assert.deepEqual(diffTimetables([before],[{...before,id:'new',source_page:9,rooms:['ICT-2','ICT-1']}]),[])
 assert.deepEqual(diffTimetables([entry()],[entry({start:'10:00',end:'11:00',rooms:['ICT-2']})])[0].fields,['Time','Rooms'])
 assert.equal(diffTimetables([entry(),entry()],[entry()])[0].kind,'removed')
 const ambiguous=diffTimetables([entry(),entry()],[entry({weekday:'Monday',start:'11:00',end:'12:00',rooms:['ICT-2']}),entry({weekday:'Tuesday',start:'12:00',end:'13:00',rooms:['ICT-2']})])
 assert.equal(ambiguous.filter(c=>c.kind==='changed').length,0)
})
test('history records first baseline, retains comparison on rebuild, and refuses invalid imports',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'timetable-history-'))
 const a={validation_status:'passed',source:{sha256:'a'.repeat(64)},generated_at:'2026-11-05T08:00:00Z',entries:[entry()]}
 const b={...a,source:{sha256:'b'.repeat(64)},generated_at:'2026-11-06T08:00:00Z',entries:[entry({rooms:['ICT-2']})]}
 try {
 assert.equal((await recordHistory(a,folder)).baseline,true)
 const report=await recordHistory(b,folder);assert.equal(report.changes[0].kind,'changed')
 assert.deepEqual(await recordHistory({...b,generated_at:'2026-11-06T09:00:00Z'},folder),report)
 assert.equal(JSON.parse(await readFile(join(folder,'index.json'),'utf8')).versions.length,2)
 await assert.rejects(recordHistory({...b,validation_status:'failed'},folder))
 }finally{await rm(folder,{recursive:true,force:true})}
})

test('calendar marker uses Malta day, stays within displayed hours and respects exact boundaries',()=>{
 const range={start:480,end:960}
 assert.equal(currentTimePosition('Friday',range,new Date('2026-11-06T07:00:00Z')),0)
 assert.equal(currentTimePosition('Friday',range,new Date('2026-11-06T11:00:00Z')),0.5)
 assert.equal(currentTimePosition('Friday',range,new Date('2026-11-06T15:00:00Z')),null)
 assert.equal(currentTimePosition('Friday',range,new Date('2026-11-06T06:59:00Z')),null)
 assert.equal(currentTimePosition('Monday',range,new Date('2026-11-06T11:00:00Z')),null)
 assert.equal(currentTimePosition('Friday',range,new Date('2026-07-03T10:00:00Z')),0.5)
 assert.equal(currentTimePosition('Saturday',range,new Date('2026-11-07T11:00:00Z')),0.5)
 assert.equal(currentTimePosition('Friday',range,new Date('2026-11-05T23:00:00Z')),null)
})

test('live table measures the full available window, caps at closing and sorts longest first',()=>{
 const fixture=data([entry({rooms:['ICT-1'],start:'09:30',end:'10:00'})])
 const date=new Date('2026-11-06T07:00:00Z') // Friday 08:00 Malta
 const result=findLiveRooms(fixture,30,date)
 assert.deepEqual(result.rooms.map(r=>[r.room,r.freeUntil,r.availableMinutes,r.atClosing]),[['ICT-2','20:00',720,true],['ICT-1','09:30',90,false]])
 assert.deepEqual(findLiveRooms(fixture,120,date).rooms.map(r=>r.room),['ICT-2'])
 assert.throws(()=>findLiveRooms(fixture,30,new Date('2026-11-06T06:00:00Z')))
})
