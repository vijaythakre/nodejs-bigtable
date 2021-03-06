/*!
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';
const assert = require('assert');
const testcases = require('./read-rows-acceptance-test.json').tests;
const Stream = require('stream').PassThrough;
const Table = require('../src/table.js');
const Row = require('../src/row.js');
const ProtoBuf = require('protobufjs');
ProtoBuf.convertFieldsToCamelCase = true;
const path = require('path');
const protosRoot = path.resolve(__dirname, '../protos');
const builder = ProtoBuf.loadProtoFile({
  root: protosRoot,
  file: 'google/bigtable/v2/bigtable.proto',
});
const ReadRowsResponse = builder.build('google.bigtable.v2.ReadRowsResponse');
const CellChunk = builder.build(
  'google.bigtable.v2.ReadRowsResponse.CellChunk'
);
describe('Read Row Acceptance tests', function() {
  testcases.forEach(function(test) {
    it(test.name, done => {
      const table = new Table({id: 'xyz'}, 'my-table');
      const results = [];
      const rawResults = test.results || [];
      const errorCount = rawResults.filter(result => result.error).length;
      rawResults.filter(result => !result.error).forEach(result => {
        const existingRow = results.find(filter => filter.key === result.rk);
        const row = existingRow || {key: result.rk, data: {}};
        const data = row.data;
        if (typeof existingRow === 'undefined') {
          results.push(row);
        }
        const family = data[result.fm] || {};
        data[result.fm] = family;
        const qualifier = family[result.qual] || [];
        family[result.qual] = qualifier;
        const resultLabels = [];
        if (result.label !== '') {
          resultLabels.push(result.label);
        }
        qualifier.push({
          value: result.value,
          timestamp: '' + result.ts,
          labels: resultLabels,
        });
      });
      const tableRows = results.map(rawRow => {
        const row = new Row(table, rawRow.key);
        row.data = rawRow.data;
        return row;
      });
      table.requestStream = function() {
        var stream = new Stream({
          objectMode: true,
        });

        setImmediate(function() {
          test.chunks_base64
            .map(chunk => {
              let readRowsResponse = new ReadRowsResponse();
              const cellChunk = CellChunk.decode64(chunk);
              readRowsResponse.set('chunks', [cellChunk]);
              readRowsResponse = ReadRowsResponse.decode(
                readRowsResponse.encode().toBuffer()
              ).toRaw(true, true);
              return readRowsResponse;
            })
            .forEach(readRowsResponse => stream.push(readRowsResponse));
          stream.push(null);
        });

        return stream;
      };

      const errors = [];
      const rows = [];

      table
        .createReadStream({})
        .on('error', err => {
          errors.push(err);
          verify();
        })
        .on('data', row => {
          rows.push(row);
        })
        .on('end', () => {
          verify();
        });
      function verify() {
        assert.equal(errors.length, errorCount, ' error count mismatch');
        assert.equal(rows.length, results.length, 'row count mismatch');
        assert.deepEqual(rows, tableRows, 'row mismatch');
        done();
      }
    });
  });
});
