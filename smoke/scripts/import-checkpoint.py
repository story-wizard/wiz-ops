"""Read a Logan workbook into a new checkpoint; never change catalog definitions or run results.
Usage: bundled-python scripts/import-checkpoint.py SOURCE.xlsx OUTPUT.json
"""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path
from openpyxl import load_workbook

source, destination = map(Path, sys.argv[1:3])
root = Path(__file__).resolve().parent.parent
destination = destination.resolve()
assert root not in destination.parents and not any((p / '.git').exists() for p in destination.parents), 'Store checkpoint outcomes outside source checkouts'

original = json.loads((root / 'catalog/logan-source.json').read_text())
workbook = load_workbook(source, data_only=True, read_only=True)
rows, owner, build = [], None, None
for number, values in enumerate(workbook['Smoke Test'].values, 1):
    row = list(values) + [None] * 10
    if row[0] == 'Build / version:':
        build = row[1]
    if row[3] == 'Owner:':
        owner = row[4]
    if not isinstance(row[0], str) or not re.fullmatch(r'[A-Z]+-\d+', row[0]):
        continue
    rows.append(dict(id=row[0], area=row[1], criteria=row[2], environment=row[3], owner=owner,
                     sourceRow=number, sourceResults=dict(zip(['Fresh', 'Story-user', 'Large'], row[4:7])),
                     sourceOverall=row[7], sourceIssue=row[8], sourceNotes=row[9]))
assert rows and len({r['id'] for r in rows}) == len(rows), 'Missing or duplicate test IDs'
assert all(v in {'Pass', 'Fail', 'Blocked', 'N/A', 'Not Run'} for r in rows for v in r['sourceResults'].values()), 'Unknown result state'
previous = {r['id']: r for r in original['rows']}
def stats(items):
    return dict(overall=dict(collections.Counter(r.get('sourceOverall', 'Not recorded') for r in items)),
                projectCells=dict(collections.Counter(v for r in items for v in r.get('sourceResults', {}).values())))
changes = [dict(id=r['id'], changes={k:dict(before=previous[r['id']].get(k), after=v)
           for k,v in r.items() if v != previous[r['id']].get(k)}) for r in rows if r['id'] in previous and r != previous[r['id']]]
result = dict(source=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(), sheet='Smoke Test',
              sourceBuild=build, rows=rows, comparison=dict(previous=stats(original['rows']), current=stats(rows), changes=changes,
              added=[r['id'] for r in rows if r['id'] not in previous], removed=[i for i in previous if i not in {r['id'] for r in rows}]))
with destination.open('x') as output:
    json.dump(result, output, indent=2)
    output.write('\n')
print(json.dumps(dict(rows=len(rows), sourceBuild=build, results=stats(rows))))
